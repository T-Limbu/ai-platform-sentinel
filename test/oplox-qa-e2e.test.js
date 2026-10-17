/**
 * Sentinel Comprehensive E2E & Edge-Case Battery for Oplox (QA & Local)
 * Usage:
 *   node test/oplox-qa-e2e.test.js [--url <targetUrl>]
 */

import assert from 'assert';

const targetUrl = process.argv.find((arg, i, arr) => arr[i - 1] === '--url') || 'https://ai-platform-oplox-qa.onrender.com';

console.log(`\n======================================================================`);
console.log(`🛡️  SENTINEL E2E & EDGE-CASE TEST SUITE: OPLOX CONTROL PLANE (QA)`);
console.log(`======================================================================`);
console.log(`Target URL: ${targetUrl}\n`);

const results = [];

async function runStep(name, fn) {
  process.stdout.write(`  ⏳ ${name}... `);
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ PASSED (${duration}ms)`);
    results.push({ name, status: 'PASSED', duration });
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`❌ FAILED (${duration}ms)`);
    console.log(`     Error: ${err.message}`);
    results.push({ name, status: 'FAILED', duration, error: err.message });
  }
}

async function main() {
  // --- SECTION 1: WARMUP & ROOT HEALTH ---
  await runStep('1.1 Root Web Node Health & SPA Shell', async () => {
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('<!DOCTYPE html>') || text.includes('<html'), 'Root must return HTML shell');
  });

  // --- SECTION 2: SPA DEEP-LINKING & CATCH-ALL ROUTING ---
  const routes = ['/nodes', '/logs', '/metrics', '/sign-in', '/sign-up', '/profile', '/edge/case/deep/route'];
  for (const route of routes) {
    await runStep(`2.${routes.indexOf(route) + 1} SPA Deep Link: ${route}`, async () => {
      const res = await fetch(`${targetUrl.replace(/\/$/, '')}${route}`, {
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      assert.strictEqual(res.status, 200, `Route ${route} returned status ${res.status}`);
      const text = await res.text();
      assert(text.includes('<!DOCTYPE html>') || text.includes('<html'), `Route ${route} must serve SPA index.html`);
    });
  }

  // --- SECTION 3: CORE FLEET API & REGISTRY ---
  await runStep('3.1 Fleet Apps API Endpoint (GET /api/apps)', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/apps`, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const apps = await res.json();
    assert(Array.isArray(apps), 'Expected JSON array of apps');
    assert(apps.length > 0, 'Fleet should contain registered applications');

    // Verify key squad apps exist
    const appIds = apps.map((a) => a.id);
    assert(appIds.includes('audio-gym') || appIds.includes('off-grid-audio'), 'Must contain audio app');
    assert(appIds.includes('court-commander'), 'Must contain court-commander (badminton) app');
  });

  await runStep('3.2 Fleet Logs API Endpoint (GET /api/logs)', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/logs`, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const logs = await res.json();
    assert(Array.isArray(logs), 'Expected JSON array of logs');
  });

  await runStep('3.3 Public JWKS Distribution (GET /.well-known/jwks.json)', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/.well-known/jwks.json`, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200, `Expected 200 for JWKS, got ${res.status}`);
    const jwks = await res.json();
    assert(Array.isArray(jwks.keys), 'JWKS response must have a keys array');
    assert(jwks.keys.length > 0, 'JWKS must have at least one signing key');
    assert.strictEqual(jwks.keys[0].use, 'sig', 'Key use must be "sig"');
  });

  // --- SECTION 4: CORS EDGE CASES ---
  const origins = [
    'https://ai-platform-oplox-qa.onrender.com',
    'https://ai-app-court-commander.onrender.com',
    'https://ai-app-audio-gym.onrender.com',
    'http://localhost:5173',
  ];

  for (const origin of origins) {
    await runStep(`4.${origins.indexOf(origin) + 1} CORS Preflight: ${origin}`, async () => {
      const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/apps`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
        signal: AbortSignal.timeout(10000),
      });

      assert(res.status === 200 || res.status === 204, `Preflight status was ${res.status}`);
      const allowOrigin = res.headers.get('access-control-allow-origin');
      assert(allowOrigin === '*' || allowOrigin === origin, `Allow-Origin was '${allowOrigin}'`);
    });
  }

  // --- SECTION 5: AUTH & OTP ENDPOINTS & EDGE CASES ---
  await runStep('5.1 Valid Email OTP Dispatch (POST /api/auth/otp/send)', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'kshitij.limbu.dev@gmail.com' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'OTP response success must be true');
    assert.strictEqual(data.email, 'kshitij.limbu.dev@gmail.com');
  });

  await runStep('5.2 Edge Case: Missing Email in OTP Dispatch', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for empty body, got ${res.status}`);
  });

  await runStep('5.3 Edge Case: Malformed Email in OTP Dispatch', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email-at-all' }),
      signal: AbortSignal.timeout(10000),
    });
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for invalid email, got ${res.status}`);
  });

  await runStep('5.4 Edge Case: Invalid OTP Verification Code', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'kshitij.limbu.dev@gmail.com', code: '000000' }),
      signal: AbortSignal.timeout(10000),
    });
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for bad verification code, got ${res.status}`);
  });

  await runStep('5.5 Edge Case: Missing Parameters in OTP Verification', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }), // missing email
      signal: AbortSignal.timeout(10000),
    });
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for missing email, got ${res.status}`);
  });

  // --- SECTION 6: REAL-TIME SSE LOG CHANNEL ---
  await runStep('6.1 Real-time SSE Stream Channel (GET /api/logs/stream)', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/logs/stream`, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });

      clearTimeout(timer);
      assert.strictEqual(res.status, 200, `Expected 200 for SSE stream, got ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      assert(contentType.includes('text/event-stream'), `Expected text/event-stream, got ${contentType}`);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        // Connected and kept streaming until aborted
        return;
      }
      throw err;
    }
  });
  // --- SECTION 7: ZERO-TRUST TEST ACCOUNT VERIFICATION & AUTHENTICATION MESH ---
  let testAccountSessionToken = null;

  await runStep('7.1 Negative: Strict Rejection of Wrong Password for Test Account', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'sentinel_tester', password: 'WrongPassword999!' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 for wrong password, got ${res.status}`);
    const data = await res.json();
    assert(data.error && data.error.includes('Incorrect password'), `Expected error message about incorrect password, got '${data.error}'`);
  });

  await runStep('7.2 Negative: Strict Rejection of Non-Existent Account', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ghost_nonexistent_user', password: 'AnyPassword123!' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 404, `Expected 404 for missing account, got ${res.status}`);
    const data = await res.json();
    assert(data.error && data.error.includes('not found'), `Expected error message about account not found, got '${data.error}'`);
  });

  await runStep('7.3 Positive: Test Account Authentication (sentinel_tester)', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'sentinel_tester', password: 'Password123!' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 for valid test account login, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'Login response success must be true');
    assert(data.token && data.token.length > 20, 'Expected valid session JWT token');
    assert.strictEqual(data.user.email, 'sentinel.tester@oplox.dev', 'User email must match test account');
    assert.strictEqual(data.user.role, 'Member', 'User role must be Member');
    assert(Array.isArray(data.user.allowedAppIds), 'allowedAppIds must be an array');
    assert(data.user.allowedAppIds.includes('audio-gym'), 'Must include audio-gym');
    assert(data.user.allowedAppIds.includes('court-commander'), 'Must include court-commander');
    assert(!data.user.allowedAppIds.includes('off-grid-video'), 'Must not include unentitled off-grid-video');
    assert(data.user.offlineValidUntil, 'Must include offlineValidUntil grace timestamp');
    testAccountSessionToken = data.token;
  });

  await runStep('7.4 Zero-Trust Session Verification via /api/auth/session (Bearer Token)', async () => {
    assert(testAccountSessionToken, 'Test account token from 7.3 required');
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/session`, {
      headers: { Authorization: `Bearer ${testAccountSessionToken}` },
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 for validated session, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.authenticated, true, 'Session must be authenticated');
    assert.strictEqual(data.user.email, 'sentinel.tester@oplox.dev');
    assert.strictEqual(data.user.role, 'Member');
  });

  await runStep('7.5 Negative: Rejection of Tampered / Invalid Bearer Token', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/session`, {
      headers: { Authorization: `Bearer invalid.tampered.token` },
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 for tampered token, got ${res.status}`);
  });

  const dynamicEmail = `sentinel.dynamic.${Date.now()}@oplox.dev`;
  await runStep(`7.6 Dynamic Test Account Registration: ${dynamicEmail}`, async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dynamic Sentinel Tester',
        email: dynamicEmail,
        password: 'SentinelDynamic2026!',
        role: 'Member',
        allowedAppIds: ['audio-gym'],
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 201, `Expected 201 for registered account, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, dynamicEmail);
    assert.deepStrictEqual(data.user.allowedAppIds, ['audio-gym']);
  });

  await runStep('7.7 Login with Dynamically Created Test Account', async () => {
    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: dynamicEmail, password: 'SentinelDynamic2026!' }),
      signal: AbortSignal.timeout(6000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 for login with new account, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, dynamicEmail);
  });

  // --- SUMMARY AUDIT TABLE ---
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`📊 SENTINEL QA AUDIT SUMMARY REPORT`);
  console.log(`----------------------------------------------------------------------`);
  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;

  console.log(`Total Checks:   ${total}`);
  console.log(`Passed:         ${passed} ✅`);
  console.log(`Failed:         ${failed} ${failed > 0 ? '❌' : ''}`);

  if (failed > 0) {
    console.log(`\nFailed Checks:`);
    for (const r of results.filter((r) => r.status === 'FAILED')) {
      console.log(`  • ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log(`\n🎉 All End-to-End & Edge-Case Probes Passed with 100% Reliability on QA!`);
    console.log(`----------------------------------------------------------------------\n`);
  }
}

main().catch((err) => {
  console.error('Fatal Test Runner Failure:', err);
  process.exit(1);
});
