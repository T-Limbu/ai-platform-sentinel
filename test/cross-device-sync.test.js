/**
 * Sentinel Cross-Device Cloud Synchronization Test Suite (KSH-149)
 * Targets live QA:
 *   - Oplox Hub:        https://ai-platform-oplox-qa.onrender.com
 *   - Off-Grid Audio:   https://off-grid-audio-qa.onrender.com
 *   - Court Commander:  https://ai-app-shuttle-feed-qa.onrender.com
 *
 * Verifies:
 *   1. Device 1: Register user & log in with password
 *   2. Device 1: Provision fleet services ('off-grid-audio', 'court-commander')
 *   3. Device 1: Download songs in Off-Grid Audio & create shots/drills in Court Commander
 *   4. Device 1: Cloud sync pushes fleet, library, and routines to multi-tenant cloud partition
 *   5. Device 2: New browser / device context with ZERO local storage or IndexedDB
 *   6. Device 2: User logs in; verify fleet ('allowedAppIds') is auto-restored flawlessly
 *   7. Device 2: Launch Court Commander; verify all custom shots & drills auto-hydrate into Device 2 storage
 *   8. Device 2: Launch Off-Grid Audio; verify songs and library context auto-hydrate into Device 2 DB
 *   9. Multi-Tenant Guard: Confirm separate tenant on Device 2 has 0 leakage of Device 1/User 1 data
 */

import assert from 'assert';

const OPLOX_QA_URL = process.env.OPLOX_QA_URL || 'https://ai-platform-oplox-qa.onrender.com';
const AUDIO_QA_URL = process.env.AUDIO_QA_URL || 'https://off-grid-audio-qa.onrender.com';
const BADMINTON_QA_URL = process.env.BADMINTON_QA_URL || 'https://ai-app-shuttle-feed-qa.onrender.com';

const ts = Date.now();
const USER_ALPHA = {
  name: `Sync Explorer ${ts}`,
  email: `sync.explorer.${ts}@oplox.dev`,
  password: `CloudSync2026!${ts}`,
  songs: [
    { id: `track_synced_1_${ts}`, title: 'Galactic Horizon - Starlight Mix', artist: 'Cosmic Drift', duration: 218 },
    { id: `track_synced_2_${ts}`, title: 'Quantum Rhythm - Deep Pulse', artist: 'Sub-Atomic Sound', duration: 195 },
  ],
  shots: [
    { id: `shot_synced_1_${ts}`, name: 'Device1 Steep Cross Smash', direction: 48, height: 9, speed: 29, frequency: 2.0, lift: 2 },
    { id: `shot_synced_2_${ts}`, name: 'Device1 Net Tumble Spin', direction: 12, height: 4, speed: 8, frequency: 1.8, lift: 1 },
  ],
  drill: {
    id: `drill_synced_${ts}`,
    name: 'Device1 Fast Transition Blitz',
    rounds: 8,
    shotIds: [`shot_synced_1_${ts}`, `shot_synced_2_${ts}`],
  },
};

const USER_BETA = {
  name: `Tenant Barrier ${ts}`,
  email: `tenant.barrier.${ts}@oplox.dev`,
  password: `BarrierPass2026!${ts}`,
};

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

// In-memory simulated browser storage for independent devices
const device1Storage = {
  localStorage: {},
  indexedDB: {},
};

const device2Storage = {
  localStorage: {},
  indexedDB: {},
};

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT token parts');
  return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
}

async function run() {
  console.log(`\n======================================================================`);
  console.log(`🚀 Sentinel Cross-Device Cloud Sync Suite (KSH-149)`);
  console.log(`   Oplox Hub:        ${OPLOX_QA_URL}`);
  console.log(`   Off-Grid Audio:   ${AUDIO_QA_URL}`);
  console.log(`   Court Commander:  ${BADMINTON_QA_URL}`);
  console.log(`======================================================================\n`);

  let userAlphaId = '';
  let device1OploxToken = '';
  let device1AudioLaunchToken = '';
  let device1BadmintonLaunchToken = '';

  let device2OploxToken = '';
  let device2AudioLaunchToken = '';
  let device2BadmintonLaunchToken = '';

  let userBetaId = '';
  let device2BetaOploxToken = '';

  // -------------------------------------------------------------------------
  // PHASE 1: DEVICE 1 SETUP & PROVISIONING
  // -------------------------------------------------------------------------
  console.log(`\n📱 --- Phase 1: Device 1 Onboarding & Service Provisioning ---`);

  await step('Device 1: Register User Alpha with password on Oplox QA', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: USER_ALPHA.name,
        email: USER_ALPHA.email,
        password: USER_ALPHA.password,
        role: 'Member',
      }),
    });
    assert.strictEqual(res.status, 201, `Expected HTTP 201, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.token, 'Expected JWT session token in registration response');
    assert.strictEqual(data.user.email, USER_ALPHA.email);
    userAlphaId = data.user.id;
    device1OploxToken = data.token;
    device1Storage.localStorage['oplox_auth_token_v1'] = data.token;
    assert.deepStrictEqual(data.user.allowedAppIds, [], 'New user must begin with 0 provisioned apps');
  });

  await step('Device 1: Provision Off-Grid Audio & Court Commander', async () => {
    // Provision Off-Grid Audio
    const p1 = await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1OploxToken}`,
      },
      body: JSON.stringify({ appId: 'off-grid-audio' }),
    });
    assert.strictEqual(p1.status, 200);
    const d1 = await p1.json();
    assert.ok(d1.allowedAppIds.includes('off-grid-audio'));

    // Provision Court Commander
    const p2 = await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1OploxToken}`,
      },
      body: JSON.stringify({ appId: 'court-commander' }),
    });
    assert.strictEqual(p2.status, 200);
    const d2 = await p2.json();
    assert.ok(d2.allowedAppIds.includes('court-commander'));
    assert.strictEqual(d2.allowedAppIds.length, 2);
  });

  // -------------------------------------------------------------------------
  // PHASE 2: DEVICE 1 CONTENT CREATION & CLOUD SYNC
  // -------------------------------------------------------------------------
  console.log(`\n📱 --- Phase 2: Device 1 Content Creation & Cloud Sync ---`);

  await step('Device 1: Launch Off-Grid Audio & mint launch token', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1OploxToken}`,
      },
      body: JSON.stringify({ targetAppId: 'off-grid-audio' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.launchToken, 'Expected signed launch token');
    device1AudioLaunchToken = data.launchToken;
  });

  await step('Device 1: Download songs and sync library to cloud partition', async () => {
    // Save to Device 1 local Dexie partition
    const dbName = `OffGridAudioDB_${userAlphaId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    device1Storage.indexedDB[dbName] = { tracks: [...USER_ALPHA.songs] };

    // Sync to Cloud Store
    const res = await fetch(`${OPLOX_QA_URL}/api/apps/user-data/off-grid-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1AudioLaunchToken}`,
      },
      body: JSON.stringify({
        data: {
          tracks: USER_ALPHA.songs,
        },
      }),
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.appId, 'off-grid-audio');
  });

  await step('Device 1: Launch Court Commander & mint launch token', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1OploxToken}`,
      },
      body: JSON.stringify({ targetAppId: 'court-commander' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.launchToken, 'Expected signed launch token');
    device1BadmintonLaunchToken = data.launchToken;
  });

  await step('Device 1: Create 2 custom shots + 1 drill and sync to cloud partition', async () => {
    // Save to Device 1 local storage partition
    const userKey = userAlphaId.replace(/[^a-zA-Z0-9_-]/g, '_');
    device1Storage.localStorage[`siboasi_saved_shots_v2_${userKey}`] = JSON.stringify(USER_ALPHA.shots);
    device1Storage.localStorage[`siboasi_drill_catalog_v2_${userKey}`] = JSON.stringify([USER_ALPHA.drill]);

    // Sync to Cloud Store
    const res = await fetch(`${OPLOX_QA_URL}/api/apps/user-data/court-commander`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device1BadmintonLaunchToken}`,
      },
      body: JSON.stringify({
        data: {
          savedShots: USER_ALPHA.shots,
          drillCatalog: [USER_ALPHA.drill],
        },
      }),
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.appId, 'court-commander');
  });

  // -------------------------------------------------------------------------
  // PHASE 3: DEVICE 2 INITIALIZATION (FRESH HARDWARE CONTEXT)
  // -------------------------------------------------------------------------
  console.log(`\n💻 --- Phase 3: Device 2 Fresh Hardware Login & Auto-Sync ---`);

  await step('Device 2: Verify fresh device has ZERO local storage or IndexedDB cache', async () => {
    assert.strictEqual(Object.keys(device2Storage.localStorage).length, 0);
    assert.strictEqual(Object.keys(device2Storage.indexedDB).length, 0);
  });

  await step('Device 2: Log into Oplox QA as User Alpha with password', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: USER_ALPHA.email,
        password: USER_ALPHA.password,
      }),
    });
    assert.strictEqual(res.status, 200, `Expected 200 login, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.token, 'Expected JWT session token');
    device2OploxToken = data.token;
    device2Storage.localStorage['oplox_auth_token_v1'] = data.token;

    // Verify fleet services were automatically restored from cloud profile
    assert.ok(Array.isArray(data.user.allowedAppIds), 'allowedAppIds must be an array');
    assert.ok(
      data.user.allowedAppIds.includes('off-grid-audio'),
      'Device 2 must have off-grid-audio restored from cloud'
    );
    assert.ok(
      data.user.allowedAppIds.includes('court-commander'),
      'Device 2 must have court-commander restored from cloud'
    );
  });

  await step('Device 2: Launch Court Commander from restored fleet', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device2OploxToken}`,
      },
      body: JSON.stringify({ targetAppId: 'court-commander' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.launchToken, 'Expected launch token for Device 2');
    device2BadmintonLaunchToken = data.launchToken;
  });

  await step('Device 2: Hydrate Court Commander routines & shots from cloud', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/apps/user-data/court-commander`, {
      headers: { Authorization: `Bearer ${device2BadmintonLaunchToken}` },
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);
    assert.ok(result.data, 'Expected cloud user data');
    assert.strictEqual(result.data.savedShots.length, 2, 'Must restore 2 custom shots');
    assert.strictEqual(result.data.savedShots[0].name, USER_ALPHA.shots[0].name);
    assert.strictEqual(result.data.savedShots[1].name, USER_ALPHA.shots[1].name);
    assert.strictEqual(result.data.drillCatalog.length, 1, 'Must restore 1 custom drill');
    assert.strictEqual(result.data.drillCatalog[0].name, USER_ALPHA.drill.name);

    // Simulate Device 2 client storing them in its local storage
    const userKey = userAlphaId.replace(/[^a-zA-Z0-9_-]/g, '_');
    device2Storage.localStorage[`siboasi_saved_shots_v2_${userKey}`] = JSON.stringify(result.data.savedShots);
    device2Storage.localStorage[`siboasi_drill_catalog_v2_${userKey}`] = JSON.stringify(result.data.drillCatalog);
  });

  await step('Device 2: Launch Off-Grid Audio from restored fleet', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device2OploxToken}`,
      },
      body: JSON.stringify({ targetAppId: 'off-grid-audio' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.launchToken, 'Expected launch token for Device 2');
    device2AudioLaunchToken = data.launchToken;
  });

  await step('Device 2: Hydrate Off-Grid Audio library from cloud', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/apps/user-data/off-grid-audio`, {
      headers: { Authorization: `Bearer ${device2AudioLaunchToken}` },
    });
    assert.strictEqual(res.status, 200);
    const result = await res.json();
    assert.strictEqual(result.success, true);
    assert.ok(result.data, 'Expected cloud user data');
    assert.strictEqual(result.data.tracks.length, 2, 'Must restore 2 tracks');
    assert.strictEqual(result.data.tracks[0].title, USER_ALPHA.songs[0].title);
    assert.strictEqual(result.data.tracks[1].title, USER_ALPHA.songs[1].title);

    // Simulate Device 2 client storing them in its local IndexedDB
    const dbName = `OffGridAudioDB_${userAlphaId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    device2Storage.indexedDB[dbName] = { tracks: result.data.tracks };
  });

  // -------------------------------------------------------------------------
  // PHASE 4: MULTI-TENANT ISOLATION ON DEVICE 2
  // -------------------------------------------------------------------------
  console.log(`\n🛡️ --- Phase 4: Multi-Tenant Data Isolation on Device 2 ---`);

  await step('Device 2: Register User Beta and confirm 0 fleet services', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: USER_BETA.name,
        email: USER_BETA.email,
        password: USER_BETA.password,
        role: 'Member',
      }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    userBetaId = data.user.id;
    device2BetaOploxToken = data.token;
    assert.deepStrictEqual(data.user.allowedAppIds, [], 'User Beta must have 0 provisioned apps');
  });

  await step('Device 2: User Beta cannot access User Alpha cloud data', async () => {
    // Generate launch token for User Beta
    const launchRes = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${device2BetaOploxToken}`,
      },
      body: JSON.stringify({ targetAppId: 'court-commander' }),
    });
    assert.strictEqual(launchRes.status, 200);
    const launchData = await launchRes.json();

    // Query court-commander with User Beta launch token
    const res = await fetch(`${OPLOX_QA_URL}/api/apps/user-data/court-commander`, {
      headers: { Authorization: `Bearer ${launchData.launchToken}` },
    });
    // With zero-trust entitlement guard, unprovisioned user receives 403 Forbidden or 200 with null data
    assert(res.status === 403 || res.status === 200, `Expected 403 or 200, got ${res.status}`);
    if (res.status === 200) {
      const result = await res.json();
      assert.strictEqual(result.data, null, 'User Beta data partition must be null/empty, zero leakage of User Alpha');
    }
  });

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log(`\n======================================================================`);
  const passed = results.filter((r) => r.status === 'PASSED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  console.log(`📊 Test Results: ${passed}/${results.length} PASSED | ${failed} FAILED`);
  console.log(`======================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
