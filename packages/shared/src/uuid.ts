/**
 * UUIDv7 helpers (RFC 9562) for E3 correlation IDs.
 *
 * E3 requires `correlationId` (UUIDv7) at request/CLI entry so ids are
 * time-ordered and distinct from crypto.randomUUID() UUIDv4 values.
 *
 * Uses Web Crypto (`crypto.getRandomValues`) — available on Cloudflare
 * Workers and Node ≥20.
 */

const UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a UUIDv7 string (version nibble 7, RFC variant 10).
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ms = BigInt(Date.now());
  // 48-bit big-endian Unix timestamp in milliseconds
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // version 7 (high nibble of byte 6)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC variant 10xxxxxx (high bits of byte 8 — clock_seq_hi_and_reserved)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** True when `id` matches UUIDv7 layout (version 7 + RFC variant). */
export function isUuidv7(id: string): boolean {
  return UUIDV7_RE.test(id);
}
