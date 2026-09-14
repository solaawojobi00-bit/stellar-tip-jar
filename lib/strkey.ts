/**
 * Minimal vendored strkey validation (SEP-0023).
 *
 * Scope: the two key types a tip destination can be — `G...` (ed25519 public
 * key) and `M...` (muxed account). Signing keys, hashes and pre-auth
 * transactions are deliberately not handled; a tip jar never needs them.
 *
 * Replace with a dependency on stellar-pay-links once that package is
 * published, rather than maintaining both. See ARCHITECTURE.md.
 */

export type StrkeyType = 'ed25519PublicKey' | 'muxedAccount';

export interface DecodedStrkey {
  type: StrkeyType;
  /** Raw key material: 32 bytes for G, 40 bytes (32 key + 8 id) for M. */
  payload: Uint8Array;
}

/** Version byte (already shifted) → key type and expected payload length. */
const VERSION_BYTES: Record<number, { type: StrkeyType; payloadLength: number }> = {
  // 6 << 3
  0x30: { type: 'ed25519PublicKey', payloadLength: 32 },
  // 12 << 3
  0x60: { type: 'muxedAccount', payloadLength: 40 },
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode unpadded RFC 4648 base32. Returns null on any character outside the
 * alphabet, or on a length that could not have come from whole bytes.
 */
function base32Decode(input: string): Uint8Array | null {
  // A valid encoding never has leftover bits that don't form a whole byte.
  if (input.length === 0 || (input.length * 5) % 8 >= 5) return null;

  const out = new Uint8Array(Math.floor((input.length * 5) / 8));
  let buffer = 0;
  let bitsLeft = 0;
  let written = 0;

  for (const char of input) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) return null;

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out[written++] = (buffer >> bitsLeft) & 0xff;
    }
  }

  // Any remaining bits must be zero padding, not dropped data.
  if (bitsLeft > 0 && (buffer & ((1 << bitsLeft) - 1)) !== 0) return null;

  return out;
}

/** CRC16-XModem, as used by strkey checksums. */
export function crc16(data: Uint8Array): number {
  let crc = 0x0000;

  for (const byte of data) {
    let code = (crc >>> 8) & 0xff;
    code ^= byte & 0xff;
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }

  return crc & 0xffff;
}

/**
 * Decode and checksum-verify a strkey. Returns null rather than throwing —
 * an invalid `dest` is an expected input here, not an exceptional one.
 */
export function decodeStrkey(value: string): DecodedStrkey | null {
  if (typeof value !== 'string') return null;

  // Reject lowercase outright instead of upcasing: strkeys are canonically
  // uppercase, and silently accepting other casings hides copy/paste damage.
  if (!/^[A-Z2-7]+$/.test(value)) return null;

  const decoded = base32Decode(value);
  if (decoded === null || decoded.length < 3) return null;

  const spec = VERSION_BYTES[decoded[0]];
  if (!spec) return null;

  if (decoded.length !== 1 + spec.payloadLength + 2) return null;

  const body = decoded.subarray(0, decoded.length - 2);
  const expected = crc16(body);
  const actual = decoded[decoded.length - 2] | (decoded[decoded.length - 1] << 8);
  if (expected !== actual) return null;

  return { type: spec.type, payload: decoded.slice(1, decoded.length - 2) };
}

/** True if `value` is a checksum-valid `G...` or `M...` address. */
export function isValidDestination(value: string): boolean {
  return decodeStrkey(value) !== null;
}

/** True if `value` is a checksum-valid strkey of the given type. */
export function isValidStrkeyOfType(value: string, type: StrkeyType): boolean {
  return decodeStrkey(value)?.type === type;
}
