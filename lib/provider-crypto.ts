import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const hasProviderEncryptionKey = () => {
  const secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  return Boolean(secret && secret.length >= 32);
};

function encryptionKey() {
  const secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set PLAID_TOKEN_ENCRYPTION_KEY (or SESSION_SECRET) to a stable 32+ character value before connecting a live bank");
  return createHash("sha256").update(secret).digest();
}

export function encryptProviderToken(token: string) {
  if (token === "mock") return "mock";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptProviderToken(value: string) {
  if (value === "mock") return "mock";
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Stored provider token is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
