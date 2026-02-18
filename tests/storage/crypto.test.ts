// tests/storage/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/storage/crypto.js';

describe('crypto', () => {
  it('round-trips data', async () => {
    const plaintext = JSON.stringify({ hello: 'world', num: 42 });
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each call (random IV)', async () => {
    const plaintext = 'same input';
    const a = await encrypt(plaintext);
    const b = await encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('throws on corrupted data', async () => {
    await expect(decrypt('not-valid-base64!!')).rejects.toThrow();
  });
});
