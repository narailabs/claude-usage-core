// src/credentials/linux.ts
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CredentialReader } from './types.js';

const CREDS_FILE = join(homedir(), '.claude', '.credentials.json');

export class LinuxCredentialReader implements CredentialReader {
  async read(): Promise<string | null> {
    // Try file first
    try {
      const content = await readFile(CREDS_FILE, 'utf8');
      return content.trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    // Fall back to secret-tool
    try {
      const result = execSync(
        `secret-tool lookup service "Claude Code-credentials"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result.trim();
    } catch {
      return null;
    }
  }
}
