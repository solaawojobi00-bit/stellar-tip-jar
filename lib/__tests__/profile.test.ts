import { describe, expect, it } from 'vitest';

import { avatarInitials, MAX_BIO_LENGTH, parseAvatarUrl, parseBio } from '../profile';

/**
 * Tests for the avatar/bio parsers.
 *
 * Both values arrive from a query string anyone can write and are rendered to
 * other people, so most of what matters here is what gets refused: these run
 * the real parsers against the real inputs, with no stubbing anywhere.
 */

describe('parseAvatarUrl — what it accepts', () => {
  it('keeps an https image URL', () => {
    expect(parseAvatarUrl('https://example.com/me.jpg')).toBe('https://example.com/me.jpg');
  });

  it('keeps a query string on the URL, which CDNs use for sizing', () => {
    expect(parseAvatarUrl('https://cdn.example.com/a.png?w=128&fit=crop')).toBe(
      'https://cdn.example.com/a.png?w=128&fit=crop',
    );
  });

  it('ignores surrounding whitespace from a careless paste', () => {
    expect(parseAvatarUrl('  https://example.com/me.jpg  ')).toBe('https://example.com/me.jpg');
  });

  it('returns the normalised href, so the page and the link agree', () => {
    // new URL() lowercases the host and supplies the root path.
    expect(parseAvatarUrl('https://EXAMPLE.com')).toBe('https://example.com/');
  });
});

describe('parseAvatarUrl — what it refuses', () => {
  it.each([
    ['javascript:alert(1)', 'a script URL'],
    ['JavaScript:alert(1)', 'a script URL in mixed case'],
    ['data:image/svg+xml,<svg onload=alert(1)>', 'an inline data URL'],
    ['http://example.com/me.jpg', 'plain http, which is blocked as mixed content'],
    ['//example.com/me.jpg', 'a protocol-relative URL'],
    ['/me.jpg', 'a path on this deployment'],
    ['me.jpg', 'a bare filename'],
    ['vbscript:msgbox(1)', 'another script scheme'],
    ['file:///etc/passwd', 'a local file'],
    ['blob:https://example.com/abc', 'a blob URL'],
  ])('refuses %s (%s)', (raw) => {
    expect(parseAvatarUrl(raw)).toBeUndefined();
  });

  it('refuses empty and absent values', () => {
    expect(parseAvatarUrl('')).toBeUndefined();
    expect(parseAvatarUrl('   ')).toBeUndefined();
    expect(parseAvatarUrl(null)).toBeUndefined();
    expect(parseAvatarUrl(undefined)).toBeUndefined();
  });

  it('refuses an absurdly long URL rather than carrying it into the page', () => {
    const huge = `https://example.com/${'a'.repeat(4000)}.jpg`;
    expect(parseAvatarUrl(huge)).toBeUndefined();
  });

  it('never returns a value whose scheme is anything but https', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com/a.png']) {
      const result = parseAvatarUrl(raw);
      // The guarantee the <img src> leans on, stated directly.
      expect(result === undefined || result.startsWith('https://')).toBe(true);
      expect(result).toBeUndefined();
    }
  });
});

describe('parseBio', () => {
  it('keeps an ordinary one-liner as typed', () => {
    expect(parseBio('Open-source maps, drawn by hand.')).toBe('Open-source maps, drawn by hand.');
  });

  it('trims and collapses whitespace, newlines included', () => {
    expect(parseBio('  I draw   maps\n\nand charts \t ')).toBe('I draw maps and charts');
  });

  it('treats a blank or absent bio as no bio', () => {
    expect(parseBio('')).toBeUndefined();
    expect(parseBio('    ')).toBeUndefined();
    expect(parseBio('\n\t ')).toBeUndefined();
    expect(parseBio(null)).toBeUndefined();
    expect(parseBio(undefined)).toBeUndefined();
  });

  it('strips control characters instead of rendering invisible payload', () => {
    const result = parseBio('Ada\u001BLovelace');
    // Replaced with a space, not deleted — the two words stay two words.
    expect(result).toBe('Ada Lovelace');
    expect(/[\u0000-\u001F\u007F-\u009F]/.test(result!)).toBe(false);
  });

  it('turns a bio of nothing but control characters into no bio', () => {
    expect(parseBio('\u0000\u0001\u007F')).toBeUndefined();
  });

  it('caps an over-long bio and marks that it was cut', () => {
    const long = 'word '.repeat(80).trim();
    const result = parseBio(long)!;

    expect(result.length).toBeLessThanOrEqual(MAX_BIO_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('cuts an over-long bio at a word boundary, not mid-word', () => {
    const long = `${'alpha '.repeat(30)}omega`;
    const result = parseBio(long)!;

    // Everything before the ellipsis must still be whole words.
    for (const word of result.slice(0, -1).trim().split(' ')) {
      expect(word).toBe('alpha');
    }
  });

  it('still cuts a single unbroken run that has no word boundary', () => {
    const result = parseBio('x'.repeat(400))!;

    expect(result.length).toBe(MAX_BIO_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves a bio of exactly the limit untouched', () => {
    const exact = 'y'.repeat(MAX_BIO_LENGTH);

    expect(parseBio(exact)).toBe(exact);
    expect(parseBio(exact)!.endsWith('…')).toBe(false);
  });

  it('keeps punctuation and non-Latin text intact', () => {
    expect(parseBio('コーヒー代 — thanks! <3 & more')).toBe('コーヒー代 — thanks! <3 & more');
  });
});

describe('avatarInitials', () => {
  it.each([
    ['Ada', 'A'],
    ['Ada Lovelace', 'AL'],
    ['ada lovelace', 'AL'],
    ['Ada Byron Lovelace', 'AB'],
    ['  Ada   Lovelace  ', 'AL'],
    ['@ada', 'A'],
    ['7th Street Collective', '7S'],
  ])('renders %s as %s', (name, expected) => {
    expect(avatarInitials(name)).toBe(expected);
  });

  it('yields nothing when there is no name to initialise', () => {
    expect(avatarInitials(undefined)).toBe('');
    expect(avatarInitials(null)).toBe('');
    expect(avatarInitials('')).toBe('');
    expect(avatarInitials('   ')).toBe('');
  });

  it('yields nothing for a name made only of punctuation', () => {
    // The caller's cue to fall back to the jar mark rather than an empty circle.
    expect(avatarInitials('--- !!!')).toBe('');
  });
});
