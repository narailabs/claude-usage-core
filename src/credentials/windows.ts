// src/credentials/windows.ts
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { CredentialReader } from './types.js';

const CREDS_FILE = join(
  process.env['APPDATA'] ?? join(process.env['USERPROFILE'] ?? 'C:\\Users\\Default', 'AppData', 'Roaming'),
  'Claude',
  '.credentials.json'
);

export class WindowsCredentialReader implements CredentialReader {
  async read(): Promise<string | null> {
    // Try file first
    try {
      const content = await readFile(CREDS_FILE, 'utf8');
      return content.trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    // Fall back to PowerShell cmdkey
    try {
      const result = execSync(
        `powershell -Command "(Get-StoredCredential -Target 'Claude Code-credentials').Password"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result.trim() || null;
    } catch {
      return null;
    }
  }
}
