/**
 * Encrypt magic-link plaintext for durable outbox (auth.magic_link).
 * AES-256-GCM; key material from AUTH_LINK_ENCRYPTION_KEY.
 * Never log plaintext or ciphertext in product logs (E10).
 */

export type EncryptedMagicLinkPayload = {
  v: 1;
  iv: string;
  ct: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function importAesKey(secret: string) {
  const trimmed = secret.trim();
  let raw: Uint8Array;
  try {
    const decoded = base64ToBytes(trimmed);
    raw = decoded.byteLength === 32 ? decoded : new TextEncoder().encode(trimmed);
  } catch {
    raw = new TextEncoder().encode(trimmed);
  }
  if (raw.byteLength !== 32) {
    const digest = await crypto.subtle.digest("SHA-256", raw);
    raw = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptMagicLinkToken(
  plaintext: string,
  secret: string,
): Promise<EncryptedMagicLinkPayload> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    v: 1,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ctBuf)),
  };
}

export async function decryptMagicLinkToken(
  payload: EncryptedMagicLinkPayload,
  secret: string,
): Promise<string> {
  const key = await importAesKey(secret);
  const iv = base64ToBytes(payload.iv);
  const ct = base64ToBytes(payload.ct);
  const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(ptBuf);
}
