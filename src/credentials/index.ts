// src/credentials/index.ts
import type { CredentialReader } from './types.js';
import { MacOSCredentialReader } from './macos.js';
import { LinuxCredentialReader } from './linux.js';
import { WindowsCredentialReader } from './windows.js';

export type Platform = 'auto' | 'macos' | 'linux' | 'windows';

export function createCredentialReader(platform: Platform = 'auto'): CredentialReader {
  const resolved = platform === 'auto' ? detectPlatform() : platform;
  switch (resolved) {
    case 'macos': return new MacOSCredentialReader();
    case 'linux': return new LinuxCredentialReader();
    case 'windows': return new WindowsCredentialReader();
  }
}

function detectPlatform(): 'macos' | 'linux' | 'windows' {
  switch (process.platform) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}
