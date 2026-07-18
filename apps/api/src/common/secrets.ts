import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnv } from "../config/env";

// AES-256-GCM for the provider API key at rest. The key derives from
// SECRETS_ENCRYPTION_KEY (any string → sha256 → 32 bytes), so the operator can
// paste hex/base64/passphrase. Ciphertext, IV and auth tag are stored base64;
// decryption verifies the tag (tamper-evident).

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function secretsConfigured(): boolean {
  return Boolean(getEnv().SECRETS_ENCRYPTION_KEY);
}

function key(): Buffer {
  const raw = getEnv().SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("SECRETS_ENCRYPTION_KEY is not configured");
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Returns null on any failure (missing key, tamper, wrong key) — never throws. */
export function decryptSecret(secret: EncryptedSecret): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(secret.iv, "base64"));
    decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}
