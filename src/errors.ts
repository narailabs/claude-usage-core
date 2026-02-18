// src/errors.ts
export class ClaudeUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AccountNotFoundError extends ClaudeUsageError {
  constructor(accountName: string) {
    super(`Account not found: ${accountName}`);
  }
}

export class StorageError extends ClaudeUsageError {
  constructor(detail: string) {
    super(`Storage error: ${detail}`);
  }
}
