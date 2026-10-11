import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUGGESTED_AMOUNTS,
  MAX_SUGGESTED_AMOUNTS,
  amountError,
  normaliseAmounts,
} from '../amounts';
import { parseSuggestedAmounts } from '../sep7';

/**
 * The settings editor's half of the suggested-amount rules.
 *
 * The property that matters most is the last block: whatever `amountError`
 * calls acceptable must survive `parseSuggestedAmounts`, because a UI that
 * reports a value as fine while the tip page silently drops it is worse than
 * one that never offered to edit anything.
 */

describe('amountError', () => {
  it('passes the amounts a tip link actually carries', () => {
    for (const value of ['1', '5', '25', '100', '0.5', '2.5', '0.0000001', '1000000']) {
      expect(amountError(value)).toBeNull();
    }
  });

  it('says nothing about a row nobody has filled in yet', () => {
    expect(amountError('')).toBeNull();
    expect(amountError('   ')).toBeNull();
  });

  it('ignores whitespace around an otherwise valid amount', () => {
    expect(amountError('  25  ')).toBeNull();
  });

  it('rejects anything that is not a plain decimal number', () => {
    for (const value of ['abc', '5 XLM', '1e3', '1,5', '5.', '.5', '--3', '0x10']) {
      expect(amountError(value)).toBe('Numbers only — for example 25 or 2.5.');
    }
  });

  it('names the precision limit rather than calling eight decimals a typo', () => {
    expect(amountError('1.12345678')).toBe('Stellar amounts carry at most 7 decimal places.');
    expect(amountError('1.1234567')).toBeNull();
  });

  it('rejects zero, which would build a pay URI nobody can complete', () => {
    expect(amountError('0')).toBe('Must be more than zero.');
    expect(amountError('0.0')).toBe('Must be more than zero.');
    expect(amountError('0.0000000')).toBe('Must be more than zero.');
  });

  it('rejects a negative amount as a number problem, not a sign problem', () => {
    // "-5" never reaches the > 0 check: it is not a plain decimal to begin
    // with, and the message a creator sees has to match the field they typed.
    expect(amountError('-5')).toBe('Numbers only — for example 25 or 2.5.');
  });
});

describe('normaliseAmounts', () => {
  it('keeps valid rows in the order they were entered', () => {
    expect(normaliseAmounts(['25', '5', '100'])).toEqual(['25', '5', '100']);
  });

  it('drops blank and invalid rows without disturbing the rest', () => {
    expect(normaliseAmounts(['5', '', 'abc', '  ', '0', '25'])).toEqual(['5', '25']);
  });

  it('trims each row, so a stray space never reaches the link', () => {
    expect(normaliseAmounts([' 5 ', '25 '])).toEqual(['5', '25']);
  });

  it('collapses amounts that are numerically the same chip', () => {
    // The tip page keys its chips by amount, so "5" twice is both useless to
    // a visitor and a duplicate React key.
    expect(normaliseAmounts(['5', '5.0', '5.00', '25'])).toEqual(['5', '25']);
  });

  it('keeps the first spelling of a duplicate rather than the last', () => {
    expect(normaliseAmounts(['5.0', '5'])).toEqual(['5.0']);
  });

  it('stops at the maximum rather than building an unusable row of chips', () => {
    expect(normaliseAmounts(['1', '2', '3', '4', '5', '6', '7'])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(normaliseAmounts(['1', '2', '3', '4', '5', '6'])).toHaveLength(
      MAX_SUGGESTED_AMOUNTS,
    );
  });

  it('counts only kept rows towards the cap', () => {
    // Six rows, one of them junk — the five survivors all fit.
    expect(normaliseAmounts(['1', 'abc', '2', '3', '4', '5'])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('returns nothing for an empty form', () => {
    expect(normaliseAmounts([])).toEqual([]);
    expect(normaliseAmounts(['', '  '])).toEqual([]);
  });
});

describe('agreement with the query-string parser', () => {
  it('accepts exactly what a tip link is allowed to carry', () => {
    const candidates = [
      '5',
      '0.5',
      '0.0000001',
      '1.1234567',
      '1.12345678',
      '0',
      '-5',
      'abc',
      '5.',
      '.5',
      '1e3',
    ];

    for (const value of candidates) {
      const accepted = amountError(value) === null;
      const survives = parseSuggestedAmounts(value).length === 1;
      expect([value, accepted]).toEqual([value, survives]);
    }
  });

  it('produces a list the parser reads back unchanged', () => {
    const amounts = normaliseAmounts(['5', ' 25 ', 'abc', '100', '0']);
    expect(parseSuggestedAmounts(amounts.join(','))).toEqual(amounts);
  });

  it('defaults are themselves valid amounts', () => {
    expect(normaliseAmounts(DEFAULT_SUGGESTED_AMOUNTS)).toEqual(DEFAULT_SUGGESTED_AMOUNTS);
  });
});
