// src/credentials/macos.ts
import { execSync } from 'node:child_process';
import type { CredentialReader } from './types.js';

const SERVICE = 'Claude Code-credentials';

export class MacOSCredentialReader implements CredentialReader {
  async read(): Promise<string | null> {
    try {
      const result = execSync(
        `security find-generic-password -s "${SERVICE}" -w`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result.trim();
    } catch {
      return null;
    }
  }
}
