// src/tokens/index.ts
import type { ClaudeCredentials } from '../types.js';
import { OAUTH_CLIENT_ID, OAUTH_TOKEN_URL } from '../auth/index.js';

export interface TokenValidation {
  isValid: boolean;
  isExpired: boolean;
  expiresAt: Date | null;
  minutesUntilExpiry: number | null;
}

export interface RefreshResult {
  success: boolean;
  newCredentials?: string;
  error?: string;
}

export function validateToken(credentialsJson: string): TokenValidation {
  try {
    const creds: ClaudeCredentials = JSON.parse(credentialsJson);
    const expiresAtStr = creds.claudeAiOauth?.expiresAt;
    if (!expiresAtStr) return { isValid: false, isExpired: false, expiresAt: null, minutesUntilExpiry: null };
    const expiresAt = new Date(expiresAtStr);
    const now = new Date();
    const isExpired = expiresAt <= now;
    const minutesUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 60_000);
    return { isValid: !isExpired, isExpired, expiresAt, minutesUntilExpiry };
  } catch {
    return { isValid: false, isExpired: false, expiresAt: null, minutesUntilExpiry: null };
  }
}

export async function refreshToken(credentialsJson: string): Promise<RefreshResult> {
  try {
    const creds: ClaudeCredentials = JSON.parse(credentialsJson);
    const refreshTokenValue = creds.claudeAiOauth?.refreshToken;
    if (!refreshTokenValue) return { success: false, error: 'No refresh token' };

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshTokenValue, client_id: OAUTH_CLIENT_ID }),
    });

    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    const newCredentials: ClaudeCredentials = {
      claudeAiOauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      },
    };

    return { success: true, newCredentials: JSON.stringify(newCredentials) };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
