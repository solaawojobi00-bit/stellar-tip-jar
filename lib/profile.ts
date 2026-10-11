/**
 * Profile customisation carried by a tip link: an avatar image and a short
 * bio, alongside the name and amounts the link already carries.
 *
 * Phase 1 has no database, so a "profile" is still just query params — which
 * means every value here arrives from an attacker-controllable URL and is
 * rendered to other people. Both parsers are therefore closed by default:
 * anything not recognisably safe is dropped and the page renders without it,
 * the same way `parseSuggestedAmounts` drops a bad amount rather than failing
 * the whole jar.
 */

/**
 * Longest bio kept. A tip page is a glance, not an about page — past this the
 * bio pushes the QR and the amount chips below the fold on a phone, which
 * costs more than the extra words are worth.
 */
export const MAX_BIO_LENGTH = 160;

/**
 * Longest avatar URL accepted. Well past any real image URL, and short enough
 * that a megabyte of query string cannot be smuggled through the param.
 */
const MAX_AVATAR_URL_LENGTH = 2048;

/**
 * C0 and C1 control characters. A query string can carry these, and left in
 * place they are invisible payload inside someone's bio.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Normalise a bio for display: replace control characters, collapse every run
 * of whitespace — including the newlines and tabs a query string can carry —
 * into single spaces, and trim.
 *
 * Returns undefined for anything with no visible content, so callers can test
 * the result rather than re-checking for empty strings.
 */
export function parseBio(raw: string | null | undefined): string | undefined {
  const cleaned = (raw ?? '')
    // Replaced with a space rather than deleted, so a control character
    // between two words cannot glue them into one the creator never wrote.
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned === '') return undefined;
  if (cleaned.length <= MAX_BIO_LENGTH) return cleaned;

  // Truncating mid-word reads as a typo, so step back to the last space when
  // there is one close enough to matter. The ellipsis is the disclosure that
  // something was cut — silently shortening someone's words would not be.
  const clipped = cleaned.slice(0, MAX_BIO_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  const body = lastSpace > MAX_BIO_LENGTH - 20 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}

/**
 * Validate the `avatar` param. Only absolute `https:` URLs are accepted, and
 * the normalised href is returned.
 *
 * https-only on purpose, and it is not only about `javascript:`:
 *
 * - `javascript:` and `data:` are the obvious injection vectors for a value
 *   that ends up in a `src` attribute, and both are refused here rather than
 *   relying on React or the browser to decline them downstream.
 * - plain `http:` is refused because this app is served over https, where an
 *   http image is mixed content and simply does not load. Accepting it would
 *   mean building links that quietly render nothing.
 *
 * Returns undefined rather than throwing: a broken avatar should cost the
 * creator their picture, not their tip page.
 */
export function parseAvatarUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;

  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_AVATAR_URL_LENGTH) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Not absolute, or not a URL at all. A relative path cannot be an avatar
    // here — the image is hosted by the creator, not by this deployment.
    return undefined;
  }

  if (url.protocol !== 'https:') return undefined;

  return url.href;
}

/**
 * Up to two initials for the monogram shown when there is no avatar image —
 * either because the link carries none or because the one it carries failed
 * to load.
 *
 * Returns an empty string when the name yields no letters, which is the
 * caller's cue to fall back to the jar mark rather than an empty circle.
 */
export function avatarInitials(name: string | null | undefined): string {
  if (!name) return '';

  const initials = name
    .trim()
    .split(/\s+/)
    // Skip leading punctuation ("@ada" should still read as "A") and ignore
    // words made of nothing else.
    .map((word) => Array.from(word).find((char) => /[\p{L}\p{N}]/u.test(char)))
    .filter((char): char is string => char !== undefined);

  if (initials.length === 0) return '';
  return initials.slice(0, 2).join('').toUpperCase();
}
