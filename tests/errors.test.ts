// tests/errors.test.ts
import { describe, it, expect } from 'vitest';
import { ClaudeUsageError, AccountNotFoundError, StorageError } from '../src/errors.js';

describe('errors', () => {
  it('AccountNotFoundError is instanceof ClaudeUsageError', () => {
    const err = new AccountNotFoundError('Work');
    expect(err).toBeInstanceOf(ClaudeUsageError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Account not found: Work');
    expect(err.name).toBe('AccountNotFoundError');
  });

  it('StorageError is instanceof ClaudeUsageError', () => {
    const err = new StorageError('Cannot read file');
    expect(err).toBeInstanceOf(ClaudeUsageError);
    expect(err.message).toBe('Storage error: Cannot read file');
    expect(err.name).toBe('StorageError');
  });
});
