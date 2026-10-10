import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// AES-256-GCM over provider client secrets at rest (KTD3). AUTH_SECRET_KEY
// is stretched to 32B via sha256; blob format "v1:<iv>:<tag>:<ct>" base64url
// parts. Rotation/loss makes stored secrets undecryptable — operators
// re-enter them (documented in deploy docs).
function key(secretKey: string): Buffer {
  return createHash("sha256").update(secretKey, "utf8").digest();
}

export function encryptSecret(plain: string, secretKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secretKey), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

export function decryptSecret(blob: string, secretKey: string): string {
  const [v, ivB, tagB, ctB] = blob.split(":");
  if (v !== "v1" || !ivB || !tagB || !ctB) {
    throw new Error("malformed secret blob");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secretKey),
    Buffer.from(ivB, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

// constant-time compare for secret-bearing equality checks
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
