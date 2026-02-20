// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import { ClaudeUsageClient, authorize, ClaudeUsageError, AccountNotFoundError, StorageError } from '../src/index.js';

describe('barrel exports', () => {
  it('exports all public API', () => {
    expect(ClaudeUsageClient).toBeDefined();
    expect(authorize).toBeDefined();
    expect(ClaudeUsageError).toBeDefined();
    expect(AccountNotFoundError).toBeDefined();
    expect(StorageError).toBeDefined();
  });
});
