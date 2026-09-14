import { describe, expect, it } from 'vitest';

import {
  assetLabel,
  buildPayUri,
  NATIVE,
  parseAsset,
  parseSuggestedAmounts,
  type Asset,
} from '../sep7';

const DEST = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const MUXED_DEST = 'MAAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6AAAAAAAAAAAABEJ6';
const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Read the query string of a built URI back into params. */
function paramsOf(uri: string): URLSearchParams {
  return new URLSearchParams(uri.slice(uri.indexOf('?') + 1));
}

describe('parseAsset', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
    ['explicit native', 'native'],
  ])('treats %s as native XLM', (_label, raw) => {
    expect(parseAsset(raw)).toEqual(NATIVE);
  });

  it('parses a credit asset as code and issuer together', () => {
    expect(parseAsset(`USDC:${USDC_ISSUER}`)).toEqual({
      kind: 'credit',
      code: 'USDC',
      issuer: USDC_ISSUER,
    });
  });

  it('parses a 12-character alphanum code', () => {
    expect(parseAsset(`USDCALLCCTP:${USDC_ISSUER}`)).toEqual({
      kind: 'credit',
      code: 'USDCALLCCTP',
      issuer: USDC_ISSUER,
    });
  });

  it.each([
    ['no issuer', 'USDC'],
    ['empty issuer', 'USDC:'],
    ['empty code', `:${USDC_ISSUER}`],
    ['issuer is not a public key', 'USDC:not-a-key'],
    ['issuer is a muxed account', `USDC:${MUXED_DEST}`],
    ['code too long', `THIRTEENCHARS:${USDC_ISSUER}`],
    ['code has punctuation', `US-DC:${USDC_ISSUER}`],
  ])('returns null for %s rather than falling back to XLM', (_label, raw) => {
    expect(parseAsset(raw)).toBeNull();
  });
});

describe('assetLabel', () => {
  it('labels native as XLM and a credit asset by its code', () => {
    expect(assetLabel(NATIVE)).toBe('XLM');
    expect(assetLabel({ kind: 'credit', code: 'USDC', issuer: USDC_ISSUER })).toBe('USDC');
  });
});

describe('buildPayUri', () => {
  it('builds a minimal native pay URI', () => {
    const uri = buildPayUri({ destination: DEST });
    expect(uri.startsWith('web+stellar:pay?')).toBe(true);

    const params = paramsOf(uri);
    expect(params.get('destination')).toBe(DEST);
    // Native is the SEP-0007 default; sending asset params for it is wrong.
    expect(params.has('asset_code')).toBe(false);
    expect(params.has('asset_issuer')).toBe(false);
    expect(params.has('amount')).toBe(false);
  });

  it('accepts a muxed destination', () => {
    expect(paramsOf(buildPayUri({ destination: MUXED_DEST })).get('destination')).toBe(MUXED_DEST);
  });

  it('always emits code and issuer together for a credit asset', () => {
    const asset: Asset = { kind: 'credit', code: 'USDC', issuer: USDC_ISSUER };
    const params = paramsOf(buildPayUri({ destination: DEST, asset, amount: '10' }));

    expect(params.get('asset_code')).toBe('USDC');
    expect(params.get('asset_issuer')).toBe(USDC_ISSUER);
    expect(params.get('amount')).toBe('10');
  });

  it('includes memo, memo_type and msg when given', () => {
    const params = paramsOf(
      buildPayUri({
        destination: DEST,
        memo: 'thanks',
        memoType: 'MEMO_TEXT',
        msg: 'Tip for the stream',
      }),
    );

    expect(params.get('memo')).toBe('thanks');
    expect(params.get('memo_type')).toBe('MEMO_TEXT');
    expect(params.get('msg')).toBe('Tip for the stream');
  });

  it('percent-encodes a msg containing spaces and symbols', () => {
    const uri = buildPayUri({ destination: DEST, msg: 'coffee & cake?' });
    expect(uri).toContain('msg=coffee+%26+cake%3F');
    expect(paramsOf(uri).get('msg')).toBe('coffee & cake?');
  });

  it('omits empty optional values instead of sending blanks', () => {
    const params = paramsOf(buildPayUri({ destination: DEST, amount: '', memo: '', msg: '' }));
    expect(params.has('amount')).toBe(false);
    expect(params.has('memo')).toBe(false);
    expect(params.has('msg')).toBe(false);
  });

  it('throws on an invalid destination', () => {
    expect(() => buildPayUri({ destination: 'not-a-key' })).toThrow(/Invalid SEP-0007 destination/);
  });
});

describe('parseSuggestedAmounts', () => {
  it('parses a comma-separated list', () => {
    expect(parseSuggestedAmounts('5,10,25')).toEqual(['5', '10', '25']);
  });

  it('trims surrounding whitespace', () => {
    expect(parseSuggestedAmounts(' 5 , 10 ')).toEqual(['5', '10']);
  });

  it('keeps decimal amounts up to 7 places', () => {
    expect(parseSuggestedAmounts('0.5,1.2500000')).toEqual(['0.5', '1.2500000']);
  });

  it('drops invalid entries instead of failing the whole page', () => {
    expect(parseSuggestedAmounts('5,abc,10,-3,0,1.12345678')).toEqual(['5', '10']);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('returns an empty list when %s', (_label, raw) => {
    expect(parseSuggestedAmounts(raw)).toEqual([]);
  });
});
