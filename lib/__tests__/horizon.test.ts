import { describe, expect, it } from 'vitest';

import creditPage from './fixtures/horizon-payments-credit.json';
import nativePage from './fixtures/horizon-payments-native.json';
import {
  fromStroops,
  isMatchingPayment,
  sumPayments,
  toStroops,
  type HorizonPaymentRecord,
} from '../horizon';
import { NATIVE, type Asset } from '../sep7';

/**
 * Fixtures are real responses recorded from horizon.stellar.org
 * (/accounts/{id}/payments), trimmed to a mix of incoming and outgoing
 * records. No network calls and no hand-invented response shapes.
 */
const NATIVE_DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';
const CREDIT_DEST = 'GAHKUR6V6FEBAZ5SFZFBJP7QUZ7J2HNUQTF2P3JNK5WKHSCJTV43H7DS';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const USDC: Asset = { kind: 'credit', code: 'USDC', issuer: USDC_ISSUER };

const nativeRecords = nativePage._embedded.records as HorizonPaymentRecord[];
const creditRecords = creditPage._embedded.records as HorizonPaymentRecord[];

describe('stroop conversion', () => {
  it.each([
    ['0', 0n],
    ['1', 10_000_000n],
    ['0.0000001', 1n],
    ['2.1038003', 21_038_003n],
    ['2706.6439900', 27_066_439_900n],
  ])('converts %s', (amount, stroops) => {
    expect(toStroops(amount)).toBe(stroops);
  });

  it('pads a short fraction rather than misreading its scale', () => {
    // "1.5" is 1.5 XLM, not 0.00000015.
    expect(toStroops('1.5')).toBe(15_000_000n);
  });

  it('round-trips through Horizon 7-decimal form', () => {
    expect(fromStroops(toStroops('23192.9749800'))).toBe('23192.9749800');
    expect(fromStroops(0n)).toBe('0.0000000');
  });
});

describe('isMatchingPayment', () => {
  it('accepts a native payment to the destination', () => {
    const incoming = nativeRecords.find((r) => r.to === NATIVE_DEST)!;
    expect(isMatchingPayment(incoming, NATIVE_DEST, NATIVE)).toBe(true);
  });

  it('rejects an outgoing payment from the destination', () => {
    const outgoing = nativeRecords.find((r) => r.to !== NATIVE_DEST)!;
    expect(isMatchingPayment(outgoing, NATIVE_DEST, NATIVE)).toBe(false);
  });

  it('never counts a credit asset toward a native total', () => {
    const usdcPayment = creditRecords.find((r) => r.to === CREDIT_DEST)!;
    expect(usdcPayment.asset_code).toBe('USDC');
    expect(isMatchingPayment(usdcPayment, CREDIT_DEST, NATIVE)).toBe(false);
  });

  it('never counts a native payment toward a credit total', () => {
    const xlmPayment = nativeRecords.find((r) => r.to === NATIVE_DEST)!;
    expect(isMatchingPayment(xlmPayment, NATIVE_DEST, USDC)).toBe(false);
  });

  it('rejects the same asset code from a different issuer', () => {
    const usdcPayment = creditRecords.find((r) => r.to === CREDIT_DEST)!;
    const impostor: Asset = {
      kind: 'credit',
      code: 'USDC',
      issuer: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    };
    expect(isMatchingPayment(usdcPayment, CREDIT_DEST, impostor)).toBe(false);
  });

  it('ignores account-creation records, which fund rather than tip', () => {
    const createAccount: HorizonPaymentRecord = {
      id: '1',
      type: 'create_account',
      asset_type: 'native',
      account: NATIVE_DEST,
      starting_balance: '100.0000000',
    };
    expect(isMatchingPayment(createAccount, NATIVE_DEST, NATIVE)).toBe(false);
  });
});

describe('sumPayments', () => {
  it('sums incoming native payments from a recorded Horizon page', () => {
    // Independently computed from the fixture's amount fields.
    expect(sumPayments(nativeRecords, NATIVE_DEST, NATIVE)).toEqual({
      total: '23192.9749800',
      count: 8,
    });
  });

  it('sums incoming USDC payments from a recorded Horizon page', () => {
    expect(sumPayments(creditRecords, CREDIT_DEST, USDC)).toEqual({
      total: '828.8100000',
      count: 8,
    });
  });

  it('keeps per-asset totals separate across the same record set', () => {
    const asNative = sumPayments(creditRecords, CREDIT_DEST, NATIVE);
    const asUsdc = sumPayments(creditRecords, CREDIT_DEST, USDC);

    expect(asNative).toEqual({ total: '0.0000000', count: 0 });
    expect(asUsdc.count).toBe(8);
  });

  it('returns a zero total for an address with no matching payments', () => {
    expect(sumPayments(nativeRecords, CREDIT_DEST, NATIVE)).toEqual({
      total: '0.0000000',
      count: 0,
    });
  });

  it('returns a zero total for an empty page', () => {
    expect(sumPayments([], NATIVE_DEST, NATIVE)).toEqual({ total: '0.0000000', count: 0 });
  });

  it('does not drift when summing many small amounts', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in stroops it is exact.
    const records: HorizonPaymentRecord[] = [
      { id: 'a', type: 'payment', asset_type: 'native', to: NATIVE_DEST, amount: '0.1000000' },
      { id: 'b', type: 'payment', asset_type: 'native', to: NATIVE_DEST, amount: '0.2000000' },
    ];
    expect(sumPayments(records, NATIVE_DEST, NATIVE).total).toBe('0.3000000');
  });
});
