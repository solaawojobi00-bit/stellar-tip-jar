import { describe, expect, it } from 'vitest';

import { decodeStrkey, isValidDestination, isValidStrkeyOfType } from '../strkey';

/**
 * Vectors generated with @stellar/stellar-base and cross-checked against this
 * implementation (4000 randomized round-trips, zero disagreements). They are
 * real encoder output, not hand-written strings.
 */
const G_ZERO = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const G_ONES = 'GD7777777777777777777777777777777777777777777777777773DB';
const G_SEQ = 'GAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB7JZX';
const G_REAL = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const M_ID_0 = 'MAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6AAAAAAAAAAAABEJ6';
const M_ID_1 = 'MAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6AAAAAAAAAAAAFUY6';

describe('decodeStrkey', () => {
  it.each([G_ZERO, G_ONES, G_SEQ, G_REAL])('decodes ed25519 public key %s', (key) => {
    const decoded = decodeStrkey(key);
    expect(decoded).not.toBeNull();
    expect(decoded?.type).toBe('ed25519PublicKey');
    expect(decoded?.payload).toHaveLength(32);
  });

  it.each([M_ID_0, M_ID_1])('decodes muxed account %s', (key) => {
    const decoded = decodeStrkey(key);
    expect(decoded).not.toBeNull();
    expect(decoded?.type).toBe('muxedAccount');
    // 32 bytes of key material plus an 8-byte subaccount id.
    expect(decoded?.payload).toHaveLength(40);
  });

  it('recovers the exact key material', () => {
    expect(Array.from(decodeStrkey(G_ZERO)!.payload)).toEqual(new Array(32).fill(0));
    expect(Array.from(decodeStrkey(G_ONES)!.payload)).toEqual(new Array(32).fill(255));
  });

  it('distinguishes muxed accounts that differ only by subaccount id', () => {
    const id0 = decodeStrkey(M_ID_0)!.payload;
    const id1 = decodeStrkey(M_ID_1)!.payload;
    expect(Array.from(id0.subarray(0, 32))).toEqual(Array.from(id1.subarray(0, 32)));
    expect(Array.from(id0.subarray(32))).not.toEqual(Array.from(id1.subarray(32)));
  });
});

describe('isValidDestination', () => {
  it('rejects a single flipped character (checksum catches typos)', () => {
    // Last data character changed; the CRC16 no longer matches.
    const typo = `${G_REAL.slice(0, 20)}${G_REAL[20] === 'A' ? 'B' : 'A'}${G_REAL.slice(21)}`;
    expect(typo).not.toBe(G_REAL);
    expect(isValidDestination(typo)).toBe(false);
  });

  it('rejects a truncated address', () => {
    expect(isValidDestination(G_REAL.slice(0, -1))).toBe(false);
  });

  it('rejects a lowercase address rather than silently upcasing it', () => {
    expect(isValidDestination(G_REAL.toLowerCase())).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['bare prefix', 'G'],
    ['non-base32 characters', 'G0000000000000000000000000000000000000000000000000000001'],
    ['whitespace padded', ` ${G_REAL} `],
  ])('rejects %s', (_label, value) => {
    expect(isValidDestination(value)).toBe(false);
  });

  it('rejects a secret seed — a tip jar must never accept an S-key', () => {
    // Real, checksum-valid S-key: the seed whose public key is G_REAL.
    const seed = 'SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X';
    expect(isValidDestination(seed)).toBe(false);
  });
});

describe('isValidStrkeyOfType', () => {
  it('accepts only the requested type', () => {
    expect(isValidStrkeyOfType(G_REAL, 'ed25519PublicKey')).toBe(true);
    expect(isValidStrkeyOfType(G_REAL, 'muxedAccount')).toBe(false);
    expect(isValidStrkeyOfType(M_ID_0, 'muxedAccount')).toBe(true);
    expect(isValidStrkeyOfType(M_ID_0, 'ed25519PublicKey')).toBe(false);
  });
});
