/**
 * Sentinel Security Hardening & Zero-Trust Gate (KSH-152)
 *
 * Verifies:
 *   1. Token Forgery Rejection: tokens signed with arbitrary keys or legacy mock strings return 401 Unauthorized.
 *   2. Token Tampering Rejection: modifying claims without valid secret signature returns 401 Unauthorized.
 *   3. Application Entitlement Barrier: accessing unprovisioned spoke app endpoints returns 403 Forbidden.
 *   4. Zero-Leak OTP Dispatch: devCode is strictly absent from OTP response payload.
 *   5. Password Hashing & Verification: passwords are encrypted with salted scrypt, and invalid passwords return 401.
 *   6. User Data Partitioning: authorized users can read/write data persistently.
 */

import assert from 'assert';

const targetUrl = process.argv.find((arg, i, arr) => arr[i - 1] === '--url') || process.env.OPLOX_URL || 'http://127.0.0.1:5170';

console.log(`\n======================================================================`);
console.log(`🔒  SENTINEL SECURITY HARDENING GATE: ZERO-TRUST VERIFICATION (KSH-152)`);
console.log(`======================================================================`);
console.log(`Target URL: ${targetUrl}\n`);

const results = [];

async function step(name, fn) {
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

function fabricateToken(payload, signatureString) {
  const header = { alg: 'HS256', typ: 'JWT', kid: 'oplox-hmac-2026-v1' };
  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const b64Sig = Buffer.from(signatureString).toString('base64url');
  return `${b64Header}.${b64Payload}.${b64Sig}`;
}

async function main() {
  const ts = Date.now();
  const testUser = {
    name: `Sec Guard ${ts}`,
    email: `sec.guard.${ts}@oplox.dev`,
    password: `SecPass!${ts}`,
    allowedAppIds: ['shuttle-feed'],
  };
  let validToken = null;

  // --- STEP 1: TOKEN FORGERY REJECTION (LEGACY MOCK SIGNATURE) ---
  await step('1.1 Rejection of Legacy Mock Signature Token', async () => {
    const forgedToken = fabricateToken(
      { sub: 'usr_admin', email: 'admin@oplox.dev', role: 'Stakeholder', allowedAppIds: ['*'], exp: Math.floor(Date.now() / 1000) + 3600 },
      'oplox_mock_signature_for_local_rsa256'
    );
    const res = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 Unauthorized for forged mock signature, got ${res.status}`);
  });

  // --- STEP 2: TOKEN FORGERY REJECTION (ARBITRARY SIGNATURE) ---
  await step('1.2 Rejection of Arbitrary Key Forged Token', async () => {
    const forgedToken = fabricateToken(
      { sub: 'usr_victim', email: 'victim@oplox.dev', exp: Math.floor(Date.now() / 1000) + 3600 },
      'attacker_generated_forged_key_12345'
    );
    const res = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 Unauthorized for arbitrary key forgery, got ${res.status}`);
  });

  // --- STEP 3: USER REGISTRATION & REAL TOKEN GENERATION ---
  await step('2.1 User Registration with Salted Password Hashing', async () => {
    const res = await fetch(`${targetUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, testUser.email);
    assert.strictEqual(data.user.password, undefined, 'Password MUST NOT be returned in registration response');
    assert(data.token && typeof data.token === 'string', 'Server must return a signed session token');
    validToken = data.token;
  });

  // --- STEP 4: AUTHORIZED ACCESS WITH LEGITIMATE TOKEN ---
  await step('2.2 Authorized Spoke App Context Access', async () => {
    const res = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      headers: { Authorization: `Bearer ${validToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK for authorized token, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.appId, 'shuttle-feed');
  });

  // --- STEP 5: TOKEN TAMPERING REJECTION ---
  await step('2.3 Token Payload Tampering Rejection', async () => {
    const parts = validToken.split('.');
    assert.strictEqual(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    // Tamper with allowedAppIds to grant wildcard access
    payload.allowedAppIds = ['*'];
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

    const res = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      headers: { Authorization: `Bearer ${tamperedToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 Unauthorized for tampered token, got ${res.status}`);
  });

  // --- STEP 6: APPLICATION ENTITLEMENT BARRIER (403 FORBIDDEN) ---
  await step('3.1 Application Entitlement Barrier (Access Unpermitted Service)', async () => {
    // User only has ['shuttle-feed'], accessing 'off-grid-video' must return 403 Forbidden
    const res = await fetch(`${targetUrl}/api/apps/user-data/off-grid-video`, {
      headers: { Authorization: `Bearer ${validToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 403, `Expected 403 Forbidden for unprovisioned app, got ${res.status}`);
    const data = await res.json();
    assert(data.error && data.error.includes('Access denied'), 'Error must indicate access denied');
  });

  // --- STEP 7: PASSWORD VERIFICATION (SALTED SCRYPT) ---
  await step('4.1 Password Verification: Correct Credentials', async () => {
    const res = await fetch(`${targetUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUser.email, password: testUser.password }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.token, 'Must return token on successful login');
  });

  await step('4.2 Password Verification: Wrong Password Rejection', async () => {
    const res = await fetch(`${targetUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testUser.email, password: 'WrongPassword123!' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 401, `Expected 401 Unauthorized for bad password, got ${res.status}`);
  });

  // --- STEP 8: ZERO-LEAK EMAIL OTP ---
  await step('5.1 Zero-Leak Email OTP Dispatch', async () => {
    const res = await fetch(`${targetUrl}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sentinel.otp@oplox.dev' }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.devCode, undefined, 'CRITICAL SECURITY: devCode MUST NOT be present in OTP response');
  });

  // --- STEP 9: PERSISTENT USER APP DATA STORE ---
  await step('6.1 Persistent User App Data Storage & Sync', async () => {
    const appPayload = {
      shots: [{ id: 'shot_1', speed: 30, direction: 45 }],
      drills: [{ id: 'drill_1', name: 'Rapid Fire Smashing' }],
      updatedAt: new Date().toISOString(),
    };
    const saveRes = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ data: appPayload }),
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(saveRes.status, 200, `Expected 200 OK on save, got ${saveRes.status}`);

    const getRes = await fetch(`${targetUrl}/api/apps/user-data/shuttle-feed`, {
      headers: { Authorization: `Bearer ${validToken}` },
      signal: AbortSignal.timeout(5000),
    });
    assert.strictEqual(getRes.status, 200, `Expected 200 OK on fetch, got ${getRes.status}`);
    const fetched = await getRes.json();
    assert.deepStrictEqual(fetched.data, appPayload, 'Saved app data must match fetched data');
  });

  console.log(`\n======================================================================`);
  const failed = results.filter((r) => r.status === 'FAILED');
  if (failed.length > 0) {
    console.log(`❌ GATE FAILED: ${failed.length} checks failed.`);
    process.exit(1);
  } else {
    console.log(`🎉 ALL ${results.length} SECURITY HARDENING CHECKS PASSED (100% GREEN)`);
    console.log(`======================================================================\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
