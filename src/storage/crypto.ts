// src/storage/crypto.ts
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { machineIdSync } from 'node-machine-id';

const pbkdf2Async = promisify(pbkdf2);

const APP_NAME = 'claude-usage-core';
const ITERATIONS = 100_000;
const KEY_LEN = 32;
const ALGORITHM = 'aes-256-gcm';

async function deriveKey(): Promise<Buffer> {
  const machineId = machineIdSync(true); // true = hash it
  const salt = createHash('sha256').update(machineId).digest();
  return pbkdf2Async(machineId + APP_NAME, salt, ITERATIONS, KEY_LEN, 'sha256');
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + authTag + ciphertext)
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

export async function decrypt(ciphertext: string): Promise<string> {
  const key = await deriveKey();
  const combined = Buffer.from(ciphertext, 'base64');
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const encrypted = combined.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
