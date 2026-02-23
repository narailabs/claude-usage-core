#!/usr/bin/env node
// scripts/e2e.mjs — manual e2e test for authorize() via claude setup-token
import { authorize } from '../dist/index.js';

delete process.env.CLAUDECODE;

console.log('Running authorize() — browser will open for claude setup-token...\n');

try {
  const raw = await authorize({ timeoutMs: 120_000 });
  const creds = JSON.parse(raw);
  const token = creds.claudeAiOauth.accessToken;
  const days = Math.round((new Date(creds.claudeAiOauth.expiresAt) - Date.now()) / 86400000);

  console.log('✅ authorize() succeeded');
  console.log('   token prefix :', token.slice(0, 24) + '...');
  console.log('   expires in   :', days, 'days');
  console.log('   refreshToken :', creds.claudeAiOauth.refreshToken === '' ? '(empty — long-lived)' : 'present');
} catch (err) {
  console.error('❌ authorize() failed:', err.message);
  process.exit(1);
}
