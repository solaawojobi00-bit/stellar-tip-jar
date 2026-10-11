import { describe, expect, it } from 'vitest';

import memoTypesPage from './fixtures/horizon-memo-types.json';
import joinedPage from './fixtures/horizon-payments-joined.json';
import {
  DEFAULT_FEED_LIMIT,
  MAX_FEED_LIMIT,
  MEMO_MAX_LENGTH,
  parseFeedLimit,
  sanitizeMemo,
  sanitizeMemoText,
  toRecentTips,
  toTipEntry,
  type JoinedPaymentRecord,
} from '../recent-tips';
import { NATIVE, type Asset } from '../sep7';

/**
 * The sanitizing layer, tested against recorded Horizon output.
 *
 * Both fixtures are real `?join=transactions` responses from
 * horizon.stellar.org, captured on 2026-10-11:
 *
 *   - horizon-payments-joined.json — one account's payments page, the source
 *     of the text-memo and no-memo cases.
 *   - horizon-memo-types.json — one real payment per memo type, collected from
 *     the ledger-wide /payments feed because a single account rarely receives
 *     all four. Each record keeps its own `to`, so the tests below address
 *     each one by its real destination.
 *
 * Only the bulky XDR blobs (envelope/result/fee meta, signatures) were dropped
 * from the embedded transactions; every field this module reads is verbatim.
 *
 * Hostile memo text has no recorded counterpart — nobody has yet paid this jar
 * with a right-to-left override — so those cases drive `sanitizeMemoText`
 * directly. It is a pure string function and needs no fixture.
 */

const records = joinedPage._embedded.records as JoinedPaymentRecord[];
const DEST = 'GBP32F37ZHXGSLOE4WAFCLNWQUMY4OUIAUGNBZUF4OD2BG6MS7WKRTSX';

const VELO: Asset = {
  kind: 'credit',
  code: 'VELO',
  issuer: 'GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M',
};

/**
 * The characters this module exists to remove, by name and code point. Spelled
 * out this way because the literal forms are invisible in a diff — a test that
 * pastes them is one a reviewer cannot check.
 */
const INVISIBLE = {
  nul: String.fromCharCode(0x0000),
  escape: String.fromCharCode(0x001b),
  'soft hyphen': String.fromCharCode(0x00ad),
  'zero-width space': String.fromCharCode(0x200b),
  'zero-width joiner': String.fromCharCode(0x200d),
  'left-to-right mark': String.fromCharCode(0x200e),
  'line separator': String.fromCharCode(0x2028),
  'right-to-left override': String.fromCharCode(0x202e),
  'word joiner': String.fromCharCode(0x2060),
  'byte-order mark': String.fromCharCode(0xfeff),
} as const;

/** The recorded payment whose transaction carries the given memo type. */
function recordWithMemoType(memoType: string): JoinedPaymentRecord {
  const found = (memoTypesPage._embedded.records as JoinedPaymentRecord[]).find(
    (record) => record.transaction?.memo_type === memoType,
  );
  if (!found) throw new Error(`fixture has no ${memoType} memo record`);
  return found;
}

/** That record's own asset, so it is matched rather than filtered out. */
function assetOf(record: JoinedPaymentRecord): Asset {
  if (record.asset_type === 'native') return NATIVE;
  return { kind: 'credit', code: record.asset_code!, issuer: record.asset_issuer! };
}

describe('sanitizeMemo — memo type', () => {
  it('shows a recorded MEMO_TEXT', () => {
    const record = recordWithMemoType('text');
    expect(record.transaction?.memo).toBe('92537513');
    expect(sanitizeMemo(record.transaction)).toBe('92537513');
  });

  it('hides a recorded MEMO_ID', () => {
    const record = recordWithMemoType('id');
    // The value is on the record; it simply must not be shown.
    expect(record.transaction?.memo).toBe('0');
    expect(sanitizeMemo(record.transaction)).toBeNull();
  });

  it('hides a recorded MEMO_HASH rather than rendering its base64', () => {
    const record = recordWithMemoType('hash');
    expect(record.transaction?.memo).toBe('FQ4lWSHxjErUHy7kuPj4bha1h6jDqnZoaQVsCTlgKZE=');
    expect(sanitizeMemo(record.transaction)).toBeNull();
  });

  it('returns null for a transaction with no memo', () => {
    const record = recordWithMemoType('none');
    expect(record.transaction?.memo_type).toBe('none');
    expect(sanitizeMemo(record.transaction)).toBeNull();
  });

  it('returns null for a MEMO_RETURN', () => {
    expect(sanitizeMemo({ memo_type: 'return', memo: 'ZGVhZGJlZWY=' })).toBeNull();
  });

  it('returns null when the transaction was not joined at all', () => {
    expect(sanitizeMemo(undefined)).toBeNull();
  });

  it('returns null when memo_type says text but no memo came with it', () => {
    expect(sanitizeMemo({ memo_type: 'text' })).toBeNull();
  });
});

describe('sanitizeMemoText — hostile and awkward input', () => {
  it('keeps an ordinary message intact', () => {
    expect(sanitizeMemoText('thanks for the stream')).toBe('thanks for the stream');
  });

  it('strips newlines, so a memo cannot break out of its row', () => {
    expect(sanitizeMemoText('tip\nfrom\rsam')).toBe('tip from sam');
  });

  it('strips a right-to-left override instead of letting it reorder the line', () => {
    const spoofed = `pay${INVISIBLE['right-to-left override']}me`;

    const cleaned = sanitizeMemoText(spoofed)!;
    expect(cleaned).not.toContain(INVISIBLE['right-to-left override']);
    expect(cleaned).toBe('pay me');
  });

  it.each(Object.entries(INVISIBLE))(
    'replaces an invisible %s with a space rather than fusing words',
    (_name, character) => {
      expect(sanitizeMemoText(`a${character}b`)).toBe('a b');
    },
  );

  it('collapses runs of whitespace left behind by stripping', () => {
    const zwsp = INVISIBLE['zero-width space'];
    expect(sanitizeMemoText(`a ${zwsp} ${zwsp} b`)).toBe('a b');
  });

  it('returns null for a memo that is only invisible characters', () => {
    const onlyInvisible = Object.values(INVISIBLE).join('');
    expect(sanitizeMemoText(onlyInvisible)).toBeNull();
  });

  it('returns null for an empty memo, which real ledger data contains', () => {
    expect(sanitizeMemoText('')).toBeNull();
    expect(sanitizeMemoText('   ')).toBeNull();
  });

  it('caps an over-long memo and marks the cut with an ellipsis', () => {
    const cleaned = sanitizeMemoText('x'.repeat(MEMO_MAX_LENGTH + 20))!;

    expect(cleaned).toHaveLength(MEMO_MAX_LENGTH);
    expect(cleaned.endsWith('…')).toBe(true);
  });

  it('leaves a memo exactly at the cap untouched', () => {
    const exact = 'y'.repeat(MEMO_MAX_LENGTH);
    expect(sanitizeMemoText(exact)).toBe(exact);
  });

  it('keeps non-Latin text, which is not the same as unsafe text', () => {
    expect(sanitizeMemoText('ありがとう')).toBe('ありがとう');
  });
});

describe('toTipEntry — what leaves the server', () => {
  const record = records[0];
  const sender = record.from!;

  it('truncates the sender to head and tail', () => {
    const entry = toTipEntry(record, DEST, NATIVE)!;

    expect(sender).toBe('GDFPCR2JQBBVPA3REJMR6TEPDLICUE5JJHLN7M3QDVLUHE7WBY6S54W2');
    expect(entry.from).toBe(`${sender.slice(0, 8)}…${sender.slice(-8)}`);
    expect(entry.from).toHaveLength(17);
  });

  it('never carries the full sender address', () => {
    const entry = toTipEntry(record, DEST, NATIVE)!;
    expect(JSON.stringify(entry)).not.toContain(sender);
  });

  it('emits only the four display fields — no raw Horizon record', () => {
    const entry = toTipEntry(record, DEST, NATIVE)!;
    expect(Object.keys(entry).sort()).toEqual(['amount', 'at', 'from', 'memo']);
  });

  it.each([
    'transaction_hash',
    'memo_bytes',
    'source_account',
    'paging_token',
    'envelope_xdr',
  ])('does not leak %s', (field) => {
    const entry = toTipEntry(record, DEST, NATIVE)!;
    expect(JSON.stringify(entry)).not.toContain(field);
  });

  it('passes the amount and timestamp through unchanged', () => {
    const entry = toTipEntry(record, DEST, NATIVE)!;
    expect(entry.amount).toBe(record.amount);
    expect(entry.at).toBe(record.created_at);
  });

  it('returns null for a payment to a different account', () => {
    const other = 'GAHKUR6V6FEBAZ5SFZFBJP7QUZ7J2HNUQTF2P3JNK5WKHSCJTV43H7DS';
    expect(toTipEntry(record, other, NATIVE)).toBeNull();
  });

  it('returns null for a payment in a different asset', () => {
    expect(toTipEntry(record, DEST, VELO)).toBeNull();
  });

  it('carries the sanitized memo, not the raw one', () => {
    const entry = toTipEntry(record, DEST, NATIVE)!;
    expect(entry.memo).toBe('2943227849');
  });

  it.each(['text', 'id', 'hash', 'none'])(
    'keeps a recorded %s-memo payment but shows the memo only when it is text',
    (memoType) => {
      const found = recordWithMemoType(memoType);
      const entry = toTipEntry(found, found.to!, assetOf(found));

      expect(entry).not.toBeNull();
      expect(entry!.memo === null).toBe(memoType !== 'text');
    },
  );
});

describe('toRecentTips — selection from a recorded page', () => {
  it('returns the native payments into this account, newest first', () => {
    const tips = toRecentTips(records, DEST, NATIVE, 10);

    // Six of the eight recorded records are native; two are VELO.
    expect(tips).toHaveLength(6);
    expect(tips[0].amount).toBe('16338.4079900');
  });

  it('honours the limit', () => {
    expect(toRecentTips(records, DEST, NATIVE, 2)).toHaveLength(2);
  });

  it('returns nothing for a limit of zero rather than everything', () => {
    expect(toRecentTips(records, DEST, NATIVE, 0)).toEqual([]);
  });

  it('keeps Horizon’s order rather than re-sorting', () => {
    const tips = toRecentTips(records, DEST, NATIVE, 10);
    const recordedOrder = records
      .filter((record) => record.asset_type === 'native')
      .map((record) => record.amount);

    expect(tips.map((entry) => entry.amount)).toEqual(recordedOrder);
  });

  it('does not merge a credit asset into the native feed', () => {
    const tips = toRecentTips(records, DEST, NATIVE, 10);
    expect(tips.map((entry) => entry.amount)).not.toContain('304025.4060000');
  });

  it('returns the credit payments when that asset is asked for', () => {
    const tips = toRecentTips(records, DEST, VELO, 10);

    expect(tips).toHaveLength(2);
    expect(tips[0].amount).toBe('304025.4060000');
  });

  it('returns nothing for the same code from a different issuer', () => {
    const impostor: Asset = { kind: 'credit', code: 'VELO', issuer: DEST };
    expect(toRecentTips(records, DEST, impostor, 10)).toEqual([]);
  });

  it('shows a text memo and omits the rest', () => {
    const tips = toRecentTips(records, DEST, NATIVE, 10);
    const memos = tips.map((entry) => entry.memo);

    expect(memos).toContain('2943227849');
    // The page contains two no-memo payments; both come through as null.
    expect(memos.filter((memo) => memo === null)).toHaveLength(2);
  });

  it('skips records missing the fields a row needs', () => {
    const incomplete: JoinedPaymentRecord[] = [
      { id: '1', type: 'payment', asset_type: 'native', to: DEST, from: 'GA', created_at: 'x' },
      { id: '2', type: 'payment', asset_type: 'native', to: DEST, amount: '1', created_at: 'x' },
      { id: '3', type: 'payment', asset_type: 'native', to: DEST, from: 'GA', amount: '1' },
    ];

    expect(toRecentTips(incomplete, DEST, NATIVE, 10)).toEqual([]);
  });

  it('includes a path payment, which credits the destination like a payment', () => {
    const pathPayment: JoinedPaymentRecord = {
      id: '9',
      type: 'path_payment_strict_receive',
      asset_type: 'native',
      to: DEST,
      from: 'GDFPCR2JQBBVPA3REJMR6TEPDLICUE5JJHLN7M3QDVLUHE7WBY6S54W2',
      amount: '7.5000000',
      created_at: '2026-09-14T20:43:54Z',
    };

    expect(toRecentTips([pathPayment], DEST, NATIVE, 10)).toHaveLength(1);
  });

  it('excludes create_account, which funds rather than tips', () => {
    const creation: JoinedPaymentRecord = {
      id: '10',
      type: 'create_account',
      account: DEST,
      starting_balance: '10.0000000',
      created_at: '2026-09-14T20:43:54Z',
    };

    expect(toRecentTips([creation], DEST, NATIVE, 10)).toEqual([]);
  });
});

describe('parseFeedLimit', () => {
  it('defaults when the param is absent or empty', () => {
    expect(parseFeedLimit(null)).toBe(DEFAULT_FEED_LIMIT);
    expect(parseFeedLimit(undefined)).toBe(DEFAULT_FEED_LIMIT);
    expect(parseFeedLimit('')).toBe(DEFAULT_FEED_LIMIT);
  });

  it('accepts the bounds', () => {
    expect(parseFeedLimit('1')).toBe(1);
    expect(parseFeedLimit(String(MAX_FEED_LIMIT))).toBe(MAX_FEED_LIMIT);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['above the cap', String(MAX_FEED_LIMIT + 1)],
    ['fractional', '2.5'],
    ['not a number', 'ten'],
    ['padded', ' 3 '],
    ['hex', '0x5'],
    ['exponential', '1e2'],
  ])('rejects %s', (_label, raw) => {
    expect(parseFeedLimit(raw)).toBeNull();
  });

  it('rejects rather than clamping an absurd request', () => {
    // Clamping 500 to 25 would quietly answer a different question.
    expect(parseFeedLimit('500')).toBeNull();
  });
});
