/**
 * Encryption helpers for at-rest secrets (Postmark tokens, Eventbrite
 * tokens, Gmail OAuth refresh tokens).
 *
 * Algorithm: AES-256-GCM via Node's built-in `crypto`. No external
 * dependencies. The same primitive that libsodium's secretbox uses.
 *
 * Key derivation: APP_ENCRYPTION_KEY is a 64-character hex string
 * (32 bytes when decoded) used directly as the AES-256 key.
 * Generate with: openssl rand -hex 32
 *
 * Ciphertext format (single string, easy to store in a text column):
 *   <iv-hex>:<auth-tag-hex>:<ciphertext-hex>
 *
 * Rotating APP_ENCRYPTION_KEY requires re-encrypting every stored secret.
 * Not supported by this module yet; add when the need arises.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env, requireEnv } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const KEY_BYTES = 32; // AES-256

function getKey(): Buffer {
  const hex = requireEnv("APP_ENCRYPTION_KEY", "encrypt/decrypt");
  if (hex.length !== KEY_BYTES * 2) {
    throw new Error(
      `APP_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex chars (${KEY_BYTES} bytes). Got ${hex.length}.`,
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext string. Returns a single string for storage.
 * Returns null if input is null/undefined/empty — convenience for nullable
 * columns.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null;
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a ciphertext string produced by encrypt(). Returns null for
 * null inputs. Throws on tampering or invalid format.
 */
export function decrypt(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined || ciphertext === "") {
    return null;
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Invalid ciphertext format. Expected <iv>:<tag>:<data>.");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Check whether the encryption key is configured.
 * Useful for the health endpoint to flag misconfigurations early.
 */
export function isEncryptionAvailable(): boolean {
  return Boolean(env.APP_ENCRYPTION_KEY && env.APP_ENCRYPTION_KEY.length === KEY_BYTES * 2);
}
