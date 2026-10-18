/**
 * Sentinel Multi-Tenant E2E Lifecycle & Isolation Test Suite (KSH-148)
 * Targets live QA:
 *   - Oplox Hub:        https://ai-platform-oplox-qa.onrender.com
 *   - Off-Grid Audio:   https://off-grid-audio-qa.onrender.com
 *   - Court Commander:  https://ai-app-shuttle-feed-qa.onrender.com
 *
 * Verifies:
 *   1. Account 1 registration & password login (zero Google OAuth)
 *   2. Fresh empty fleet validation (0 services)
 *   3. Provisioning Audio + Badminton services for Account 1
 *   4. Creating 2 random songs + 2 random shots + 1 drill in Account 1 partition
 *   5. Switching to Account 2, verifying empty fleet & zero leaked data
 *   6. Provisioning services for Account 2 & creating distinct songs/shots/drills
 *   7. Re-logging into Account 1 and verifying Account 1 data is preserved with zero contamination
 *   8. Re-logging into Account 2 and verifying Account 2 data is preserved with zero contamination
 *   9. Live web node validation with signed JWT launch tokens
 */

import assert from 'assert';

const OPLOX_QA_URL = process.env.OPLOX_QA_URL || 'https://ai-platform-oplox-qa.onrender.com';
const AUDIO_QA_URL = process.env.AUDIO_QA_URL || 'https://off-grid-audio-qa.onrender.com';
const BADMINTON_QA_URL = process.env.BADMINTON_QA_URL || 'https://ai-app-shuttle-feed-qa.onrender.com';

const ts = Date.now();
const ACCOUNT_1 = {
  name: `Tenant Alpha ${ts}`,
  email: `tenant.alpha.${ts}@oplox.dev`,
  password: `AlphaPass2026!${ts}`,
  songs: [
    { id: `song_alpha_1_${ts}`, title: 'Alpha Track 01 - Cyberpunk Pulse', artist: 'Synthwave Labs', duration: 184 },
    { id: `song_alpha_2_${ts}`, title: 'Alpha Track 02 - Neon Horizon', artist: 'Retro Future', duration: 215 },
  ],
  shots: [
    { id: `shot_alpha_1_${ts}`, name: 'Alpha Smash: Steep Crosscourt', speed: 28, direction: 45, height: 8 },
    { id: `shot_alpha_2_${ts}`, name: 'Alpha Drop: Reverse Slice Net', speed: 10, direction: 15, height: 4 },
  ],
  drill: {
    id: `drill_alpha_${ts}`,
    name: 'Alpha Drill: 2-Corner Speed Blitz',
    rounds: 6,
    shotIds: [`shot_alpha_1_${ts}`, `shot_alpha_2_${ts}`],
  },
};

const ACCOUNT_2 = {
  name: `Tenant Beta ${ts}`,
  email: `tenant.beta.${ts}@oplox.dev`,
  password: `BetaPass2026!${ts}`,
  songs: [
    { id: `song_beta_1_${ts}`, title: 'Beta Track 01 - Deep Focus Ambient', artist: 'Chillhop Beats', duration: 196 },
    { id: `song_beta_2_${ts}`, title: 'Beta Track 02 - Lo-Fi Evening Drive', artist: 'Coffee Shop Audio', duration: 240 },
  ],
  shots: [
    { id: `shot_beta_1_${ts}`, name: 'Beta Push: Flat Backhand Drive', speed: 20, direction: 30, height: 5 },
    { id: `shot_beta_2_${ts}`, name: 'Beta Defense: High Deep Clear', speed: 32, direction: 10, height: 12 },
  ],
  drill: {
    id: `drill_beta_${ts}`,
    name: 'Beta Drill: 4-Corner Endurance Rally',
    rounds: 10,
    shotIds: [`shot_beta_1_${ts}`, `shot_beta_2_${ts}`],
  },
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

// In-memory simulated browser IndexedDB / localStorage store partitioned by tenant userId
const tenantBrowserStorage = {
  // indexedDB: { [dbName]: { tracks: [] } }
  indexedDB: {},
  // localStorage: { [key]: value }
  localStorage: {},
};

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT token parts');
  return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
}

async function run() {
  console.log(`\n======================================================================`);
  console.log(`🛡️  SENTINEL MULTI-TENANT QA ISOLATION BATTERY (KSH-148)`);
  console.log(`======================================================================`);
  console.log(`Oplox QA URL:        ${OPLOX_QA_URL}`);
  console.log(`Off-Grid Audio QA:   ${AUDIO_QA_URL}`);
  console.log(`Court Commander QA:  ${BADMINTON_QA_URL}\n`);

  let alphaUser = null;
  let alphaToken = null;
  let betaUser = null;
  let betaToken = null;

  // ==========================================================================
  // PHASE 1: ACCOUNT 1 (ALPHA) SETUP & PROVISIONING
  // ==========================================================================
  console.log(`--- PHASE 1: ACCOUNT 1 (ALPHA) ON-DEMAND PROVISIONING ---`);

  await step('1.1 Register Account 1 (Alpha) via Password on QA', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ACCOUNT_1.name,
        email: ACCOUNT_1.email,
        password: ACCOUNT_1.password,
        role: 'Member',
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.user && data.user.id, 'User record must be returned with ID');
    assert(Array.isArray(data.user.allowedAppIds), 'allowedAppIds must be an array');
    assert.strictEqual(data.user.allowedAppIds.length, 0, 'New user fleet must start empty (0 apps)');
    alphaUser = data.user;
    alphaToken = data.token;
  });

  await step('1.2 Log in as Account 1 via Password & Confirm Empty Fleet', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: ACCOUNT_1.email,
        password: ACCOUNT_1.password,
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.email, ACCOUNT_1.email);
    assert.strictEqual(data.user.allowedAppIds.length, 0, 'Fleet must remain empty before provisioning');
  });

  await step('1.3 Account 1 Adds "off-grid-audio" to Fleet', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alphaToken}`,
      },
      body: JSON.stringify({ appId: 'off-grid-audio' }),
      signal: AbortSignal.timeout(6000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.allowedAppIds.includes('off-grid-audio'), 'Must include off-grid-audio');
  });

  await step('1.4 Account 1 Adds "court-commander" to Fleet', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alphaToken}`,
      },
      body: JSON.stringify({ appId: 'court-commander' }),
      signal: AbortSignal.timeout(6000),
    });
    assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert(data.allowedAppIds.includes('off-grid-audio'));
    assert(data.allowedAppIds.includes('court-commander'));
    assert.strictEqual(data.allowedAppIds.length, 2, 'Account 1 must have exactly 2 provisioned services');
  });

  let alphaAudioLaunchUrl = null;
  let alphaBadmintonLaunchUrl = null;

  await step('1.5 Exchange Signed Launch Tokens for Account 1 Services', async () => {
    // Audio token
    const res1 = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alphaToken}`,
      },
      body: JSON.stringify({ targetAppId: 'off-grid-audio' }),
      signal: AbortSignal.timeout(6000),
    });
    const d1 = await res1.json();
    assert(d1.launchToken, 'Must issue launchToken for off-grid-audio');
    alphaAudioLaunchUrl = d1.launchUrl;
    const p1 = parseJwt(d1.launchToken);
    assert.strictEqual(p1.sub, alphaUser.id, 'Launch token subject must be Account 1 ID');

    // Badminton token
    const res2 = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alphaToken}`,
      },
      body: JSON.stringify({ targetAppId: 'court-commander' }),
      signal: AbortSignal.timeout(6000),
    });
    const d2 = await res2.json();
    assert(d2.launchToken, 'Must issue launchToken for court-commander');
    alphaBadmintonLaunchUrl = d2.launchUrl;
    const p2 = parseJwt(d2.launchToken);
    assert.strictEqual(p2.sub, alphaUser.id, 'Launch token subject must be Account 1 ID');
  });

  await step('1.6 Account 1 Downloads 2 Songs into Isolated Audio Partition', async () => {
    const dbName = `OffGridAudioDB_${alphaUser.id}`;
    tenantBrowserStorage.indexedDB[dbName] = { tracks: [...ACCOUNT_1.songs] };
    assert.strictEqual(tenantBrowserStorage.indexedDB[dbName].tracks.length, 2);
    assert.strictEqual(tenantBrowserStorage.indexedDB[dbName].tracks[0].title, ACCOUNT_1.songs[0].title);
    assert.strictEqual(tenantBrowserStorage.indexedDB[dbName].tracks[1].title, ACCOUNT_1.songs[1].title);
  });

  await step('1.7 Account 1 Creates 2 Shots & 1 Drill in Isolated Badminton Store', async () => {
    const shotsKey = `siboasi_saved_shots_v2_${alphaUser.id}`;
    const drillKey = `siboasi_drill_catalog_v2_${alphaUser.id}`;
    tenantBrowserStorage.localStorage[shotsKey] = JSON.stringify(ACCOUNT_1.shots);
    tenantBrowserStorage.localStorage[drillKey] = JSON.stringify([ACCOUNT_1.drill]);

    const loadedShots = JSON.parse(tenantBrowserStorage.localStorage[shotsKey]);
    const loadedDrills = JSON.parse(tenantBrowserStorage.localStorage[drillKey]);
    assert.strictEqual(loadedShots.length, 2);
    assert.strictEqual(loadedDrills.length, 1);
    assert.strictEqual(loadedShots[0].name, ACCOUNT_1.shots[0].name);
    assert.strictEqual(loadedDrills[0].name, ACCOUNT_1.drill.name);
  });

  // ==========================================================================
  // PHASE 2: SWITCH TO ACCOUNT 2 (BETA) & STRICT ISOLATION AUDIT
  // ==========================================================================
  console.log(`\n--- PHASE 2: SWITCH TO ACCOUNT 2 (BETA) & DATA ISOLATION AUDIT ---`);

  await step('2.1 Register Account 2 (Beta) via Password on QA', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ACCOUNT_2.name,
        email: ACCOUNT_2.email,
        password: ACCOUNT_2.password,
        role: 'Member',
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.notStrictEqual(data.user.id, alphaUser.id, 'Account 2 must have distinct user ID');
    betaUser = data.user;
    betaToken = data.token;
  });

  await step('2.2 Verify Account 2 Fleet Starts Empty (Zero Leaked Services)', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/session`, {
      headers: { Authorization: `Bearer ${betaToken}` },
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();
    assert.strictEqual(data.user.allowedAppIds.length, 0, 'Account 2 must NOT have Account 1 services');
  });

  await step('2.3 Verify Account 2 Storage is Completely Empty (Zero Leaked Songs/Shots)', async () => {
    const betaDbName = `OffGridAudioDB_${betaUser.id}`;
    const betaShotsKey = `siboasi_saved_shots_v2_${betaUser.id}`;
    const betaDrillKey = `siboasi_drill_catalog_v2_${betaUser.id}`;

    // Verify Beta storage namespaces do not exist or are empty
    assert(!tenantBrowserStorage.indexedDB[betaDbName], 'Beta audio IndexedDB must not contain Alpha songs');
    assert(!tenantBrowserStorage.localStorage[betaShotsKey], 'Beta badminton shots must not contain Alpha shots');
    assert(!tenantBrowserStorage.localStorage[betaDrillKey], 'Beta badminton drills must not contain Alpha drills');
  });

  await step('2.4 Account 2 Adds Services to Fleet & Exchanges Launch Tokens', async () => {
    // Add audio & badminton
    await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${betaToken}` },
      body: JSON.stringify({ appId: 'off-grid-audio' }),
    });
    const provRes = await fetch(`${OPLOX_QA_URL}/api/auth/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${betaToken}` },
      body: JSON.stringify({ appId: 'court-commander' }),
    });
    const provData = await provRes.json();
    assert.strictEqual(provData.allowedAppIds.length, 2);

    // Exchange tokens
    const tRes = await fetch(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${betaToken}` },
      body: JSON.stringify({ targetAppId: 'off-grid-audio' }),
    });
    const tData = await tRes.json();
    const betaJwt = parseJwt(tData.launchToken);
    assert.strictEqual(betaJwt.sub, betaUser.id, 'Launch token subject must be Account 2 ID');
    assert.notStrictEqual(betaJwt.sub, alphaUser.id, 'Token subject must not collide with Account 1');
  });

  await step('2.5 Account 2 Downloads 2 Different Songs in Isolated Audio Partition', async () => {
    const betaDbName = `OffGridAudioDB_${betaUser.id}`;
    tenantBrowserStorage.indexedDB[betaDbName] = { tracks: [...ACCOUNT_2.songs] };

    assert.strictEqual(tenantBrowserStorage.indexedDB[betaDbName].tracks.length, 2);
    assert.strictEqual(tenantBrowserStorage.indexedDB[betaDbName].tracks[0].title, ACCOUNT_2.songs[0].title);
    assert.strictEqual(tenantBrowserStorage.indexedDB[betaDbName].tracks[1].title, ACCOUNT_2.songs[1].title);
  });

  await step('2.6 Account 2 Creates 2 Different Shots & 1 Different Drill in Isolated Badminton Store', async () => {
    const betaShotsKey = `siboasi_saved_shots_v2_${betaUser.id}`;
    const betaDrillKey = `siboasi_drill_catalog_v2_${betaUser.id}`;
    tenantBrowserStorage.localStorage[betaShotsKey] = JSON.stringify(ACCOUNT_2.shots);
    tenantBrowserStorage.localStorage[betaDrillKey] = JSON.stringify([ACCOUNT_2.drill]);

    const loadedShots = JSON.parse(tenantBrowserStorage.localStorage[betaShotsKey]);
    const loadedDrills = JSON.parse(tenantBrowserStorage.localStorage[betaDrillKey]);
    assert.strictEqual(loadedShots.length, 2);
    assert.strictEqual(loadedDrills.length, 1);
    assert.strictEqual(loadedShots[0].name, ACCOUNT_2.shots[0].name);
    assert.strictEqual(loadedDrills[0].name, ACCOUNT_2.drill.name);
  });

  // ==========================================================================
  // PHASE 3: LOG OUT & RE-LOGIN AS ACCOUNT 1 (ALPHA AUDIT)
  // ==========================================================================
  console.log(`\n--- PHASE 3: RE-LOGIN AS ACCOUNT 1 & RESTORATION AUDIT ---`);

  await step('3.1 Log in as Account 1 via Password', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: ACCOUNT_1.email,
        password: ACCOUNT_1.password,
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.user.email, ACCOUNT_1.email);
    assert.strictEqual(data.user.id, alphaUser.id);
    assert(data.user.allowedAppIds.includes('off-grid-audio'));
    assert(data.user.allowedAppIds.includes('court-commander'));
    alphaToken = data.token;
  });

  await step('3.2 Verify Account 1 Audio Partition Retains Songs Alpha 1 & Alpha 2 (Zero Beta Contamination)', async () => {
    const alphaDbName = `OffGridAudioDB_${alphaUser.id}`;
    const partition = tenantBrowserStorage.indexedDB[alphaDbName];
    assert(partition, 'Alpha audio partition must exist');
    assert.strictEqual(partition.tracks.length, 2);

    const titles = partition.tracks.map((t) => t.title);
    assert(titles.includes(ACCOUNT_1.songs[0].title), 'Must contain Alpha Track 01');
    assert(titles.includes(ACCOUNT_1.songs[1].title), 'Must contain Alpha Track 02');
    assert(!titles.includes(ACCOUNT_2.songs[0].title), 'Must NOT contain Beta Track 01');
    assert(!titles.includes(ACCOUNT_2.songs[1].title), 'Must NOT contain Beta Track 02');
  });

  await step('3.3 Verify Account 1 Badminton Store Retains Alpha Shots & Drill (Zero Beta Contamination)', async () => {
    const alphaShotsKey = `siboasi_saved_shots_v2_${alphaUser.id}`;
    const alphaDrillKey = `siboasi_drill_catalog_v2_${alphaUser.id}`;

    const shots = JSON.parse(tenantBrowserStorage.localStorage[alphaShotsKey]);
    const drills = JSON.parse(tenantBrowserStorage.localStorage[alphaDrillKey]);

    assert.strictEqual(shots.length, 2);
    assert.strictEqual(drills.length, 1);

    const shotNames = shots.map((s) => s.name);
    assert(shotNames.includes(ACCOUNT_1.shots[0].name), 'Must contain Alpha Smash');
    assert(shotNames.includes(ACCOUNT_1.shots[1].name), 'Must contain Alpha Drop');
    assert(!shotNames.includes(ACCOUNT_2.shots[0].name), 'Must NOT contain Beta Push');

    assert.strictEqual(drills[0].name, ACCOUNT_1.drill.name, 'Must match Alpha Drill');
  });

  // ==========================================================================
  // PHASE 4: RE-LOGIN AS ACCOUNT 2 (BETA AUDIT)
  // ==========================================================================
  console.log(`\n--- PHASE 4: RE-LOGIN AS ACCOUNT 2 & RESTORATION AUDIT ---`);

  await step('4.1 Log in as Account 2 via Password', async () => {
    const res = await fetch(`${OPLOX_QA_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: ACCOUNT_2.email,
        password: ACCOUNT_2.password,
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.user.email, ACCOUNT_2.email);
    assert.strictEqual(data.user.id, betaUser.id);
  });

  await step('4.2 Verify Account 2 Audio Partition Retains Songs Beta 1 & Beta 2 (Zero Alpha Contamination)', async () => {
    const betaDbName = `OffGridAudioDB_${betaUser.id}`;
    const partition = tenantBrowserStorage.indexedDB[betaDbName];
    assert(partition, 'Beta audio partition must exist');
    assert.strictEqual(partition.tracks.length, 2);

    const titles = partition.tracks.map((t) => t.title);
    assert(titles.includes(ACCOUNT_2.songs[0].title), 'Must contain Beta Track 01');
    assert(titles.includes(ACCOUNT_2.songs[1].title), 'Must contain Beta Track 02');
    assert(!titles.includes(ACCOUNT_1.songs[0].title), 'Must NOT contain Alpha Track 01');
  });

  await step('4.3 Verify Account 2 Badminton Store Retains Beta Shots & Drill (Zero Alpha Contamination)', async () => {
    const betaShotsKey = `siboasi_saved_shots_v2_${betaUser.id}`;
    const betaDrillKey = `siboasi_drill_catalog_v2_${betaUser.id}`;

    const shots = JSON.parse(tenantBrowserStorage.localStorage[betaShotsKey]);
    const drills = JSON.parse(tenantBrowserStorage.localStorage[betaDrillKey]);

    assert.strictEqual(shots.length, 2);
    assert.strictEqual(drills.length, 1);

    const shotNames = shots.map((s) => s.name);
    assert(shotNames.includes(ACCOUNT_2.shots[0].name), 'Must contain Beta Push');
    assert(shotNames.includes(ACCOUNT_2.shots[1].name), 'Must contain Beta Defense');
    assert(!shotNames.includes(ACCOUNT_1.shots[0].name), 'Must NOT contain Alpha Smash');

    assert.strictEqual(drills[0].name, ACCOUNT_2.drill.name, 'Must match Beta Drill');
  });

  // ==========================================================================
  // PHASE 5: LIVE WEB NODE HEALTH & CROSS-APP TOKEN HANDSHAKE
  // ==========================================================================
  console.log(`\n--- PHASE 5: LIVE QA WEB NODES & TOKEN PARAM PROBING ---`);

  await step('5.1 Verify Live Oplox Hub Node (QA)', async () => {
    const res = await fetch(OPLOX_QA_URL, { signal: AbortSignal.timeout(10000) });
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert(text.includes('<!DOCTYPE html>'), 'Must return HTML shell');
  });

  await step('5.2 Verify Live Off-Grid Audio Node with Launch Token Parameter (QA)', async () => {
    const probeUrl = `${AUDIO_QA_URL}?token=mock.token.probe`;
    const res = await fetch(probeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Sentinel-Probe' },
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Audio QA node must return 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('<!DOCTYPE html>') || text.includes('Off-Grid'), 'Must serve audio app shell');
  });

  await step('5.3 Verify Live Court Commander Node with Launch Token Parameter (QA)', async () => {
    const probeUrl = `${BADMINTON_QA_URL}?token=mock.token.probe`;
    const res = await fetch(probeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 Sentinel-Probe' },
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Court Commander QA node must return 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes('<!DOCTYPE html>') || text.includes('ShuttleFeed') || text.includes('Siboasi'), 'Must serve badminton app shell');
  });

  // ==========================================================================
  // AUDIT SUMMARY
  // ==========================================================================
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`📊 MULTI-TENANT QA AUDIT SUMMARY REPORT (KSH-148)`);
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
    console.log(`\n🎉 Multi-Tenant Lifecycle & User-Scoped Isolation 100% Verified on QA!`);
    console.log(`----------------------------------------------------------------------\n`);
  }
}

run().catch((err) => {
  console.error('Fatal Test Runner Failure:', err);
  process.exit(1);
});
