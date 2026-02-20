// tests/credentials/index.test.ts
import { describe, it, expect } from 'vitest';
import { createCredentialReader } from '../../src/credentials/index.js';
import { MacOSCredentialReader } from '../../src/credentials/macos.js';
import { LinuxCredentialReader } from '../../src/credentials/linux.js';
import { WindowsCredentialReader } from '../../src/credentials/windows.js';

describe('createCredentialReader', () => {
  it('returns macOS reader for macos platform', () => {
    expect(createCredentialReader('macos')).toBeInstanceOf(MacOSCredentialReader);
  });
  it('returns Linux reader for linux platform', () => {
    expect(createCredentialReader('linux')).toBeInstanceOf(LinuxCredentialReader);
  });
  it('returns Windows reader for windows platform', () => {
    expect(createCredentialReader('windows')).toBeInstanceOf(WindowsCredentialReader);
  });
  it('returns a reader for auto platform (detects current OS)', () => {
    const reader = createCredentialReader('auto');
    expect(reader).toBeDefined();
    expect(typeof reader.read).toBe('function');
  });
  it('returns a reader when called with no arguments', () => {
    const reader = createCredentialReader();
    expect(reader).toBeDefined();
    expect(typeof reader.read).toBe('function');
  });
});
