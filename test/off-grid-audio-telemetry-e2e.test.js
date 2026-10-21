/**
 * Sentinel Comprehensive E2E & Edge-Case Battery for Off-Grid Audio & Oplox Telemetry Bridge
 * Usage:
 *   node test/off-grid-audio-telemetry-e2e.test.js [--oplox-url <url>] [--audio-url <url>]
 */

import assert from 'assert';

const oploxUrl = process.argv.find((arg, i, arr) => arr[i - 1] === '--oplox-url') ||
  process.env.OPLOX_QA_URL ||
  'https://ai-platform-oplox-qa.onrender.com';

const audioUrl = process.argv.find((arg, i, arr) => arr[i - 1] === '--audio-url') ||
  process.env.AUDIO_QA_URL ||
  'https://off-grid-audio-qa.onrender.com';

console.log(`\n======================================================================`);
console.log(`🛡️  SENTINEL E2E BATTERY: OFF-GRID AUDIO & OPLOX FLEET TELEMETRY MESH`);
console.log(`======================================================================`);
console.log(`Oplox URL:       ${oploxUrl}`);
console.log(`Audio App URL:   ${audioUrl}\n`);

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

async function warmUp(url, label) {
  process.stdout.write(`  ⏳ Warming up ${label} container (cold-start tolerance)... `);
  const start = Date.now();
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.status < 500) {
        console.log(`✅ AWAKE (HTTP ${res.status} in ${Date.now() - start}ms)`);
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`⚠️ TIMEOUT (proceeding anyway)`);
  return false;
}

async function main() {
  const cleanOplox = oploxUrl.replace(/\/+$/, '');
  const cleanAudio = audioUrl.replace(/\/+$/, '');

  // --- SECTION 0: CONTAINER WARMUP ---
  await warmUp(`${cleanOplox}/api/apps`, 'Oplox');
  await warmUp(cleanAudio, 'Off-Grid Audio');

  // --- SECTION 1: CORS & INGEST ENDPOINT HEALTH ---
  await runStep('1.1 CORS Preflight for Off-Grid Audio Ingest Endpoint', async () => {
    const res = await fetch(`${cleanOplox}/api/apps/off-grid-audio/telemetry`, {
      method: 'OPTIONS',
      headers: {
        Origin: cleanAudio,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
      signal: AbortSignal.timeout(10000),
    });

    assert(res.status === 200 || res.status === 204, `Expected 200/204 for OPTIONS, got ${res.status}`);
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert(allowOrigin === '*' || allowOrigin === cleanAudio || allowOrigin === 'true', `Allow-Origin was '${allowOrigin}'`);
  });

  const canaryErrorId = `sentinel_err_${Date.now()}`;
  await runStep('1.2 Ingest Synthetic Error Telemetry (POST /api/apps/off-grid-audio/telemetry)', async () => {
    const res = await fetch(`${cleanOplox}/api/apps/off-grid-audio/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: cleanAudio,
      },
      body: JSON.stringify({
        type: 'stderr',
        message: `[ERROR] [Sentinel Canary] Media decode failed: ${canaryErrorId}`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    assert.strictEqual(res.status, 200, `Expected 200 for telemetry ingest, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'Expected { success: true }');
  });

  await runStep('1.3 Retrieve App-Filtered Logs (GET /api/logs?appId=off-grid-audio)', async () => {
    const res = await fetch(`${cleanOplox}/api/logs?appId=off-grid-audio&limit=50`, {
      signal: AbortSignal.timeout(10000),
    });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const logs = await res.json();
    assert(Array.isArray(logs), 'Expected array of logs');
    assert(logs.length > 0, 'Off-grid-audio log buffer must contain entries');

    const found = logs.find((l) => l.message && l.message.includes(canaryErrorId));
    assert(found, `Expected to find canary log with ID ${canaryErrorId}`);
    assert.strictEqual(found.appId, 'off-grid-audio');
    assert.strictEqual(found.type, 'stderr');
  });

  // --- SECTION 2: REAL-TIME SSE LOG CHANNEL BROADCAST ---
  await runStep('2.1 Real-Time SSE Log Broadcast Verification', async () => {
    const sseCanaryId = `sse_canary_${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let eventReceived = false;

    // Connect SSE client
    const ssePromise = (async () => {
      try {
        const res = await fetch(`${cleanOplox}/api/logs/stream`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });

        assert.strictEqual(res.status, 200, `Expected 200 for SSE, got ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No body stream reader available');

        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const entry = JSON.parse(line.replace('data: ', '').trim());
                if (entry.message && entry.message.includes(sseCanaryId)) {
                  eventReceived = true;
                  controller.abort(); // Succeeded, exit early
                  return;
                }
              } catch {}
            }
          }
        }
      } catch (e) {
        if (e.name === 'AbortError' && eventReceived) return;
        throw e;
      }
    })();

    // Allow SSE connection to establish, then dispatch test event
    await new Promise((r) => setTimeout(r, 600));

    await fetch(`${cleanOplox}/api/apps/off-grid-audio/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'stdout',
        message: `[INFO] [Sentinel SSE Canary] Live stream active: ${sseCanaryId}`,
      }),
      signal: AbortSignal.timeout(5000),
    });

    try {
      await ssePromise;
    } catch (e) {
      if (!eventReceived) throw e;
    } finally {
      clearTimeout(timeout);
    }

    assert(eventReceived, `SSE log stream did not broadcast canary event ${sseCanaryId} within timeout`);
  });

  // --- SECTION 3: SSO TOKEN MINT LIFECYCLE & DUAL LOG ATTRIBUTION ---
  let sessionToken = null;
  await runStep('3.1 Authenticate with Sentinel Test Account', async () => {
    const res = await fetch(`${cleanOplox}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'sentinel_tester', password: 'Password123!' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Login failed with ${res.status}`);
    const data = await res.json();
    sessionToken = data.token;
    assert(sessionToken, 'Expected session JWT token');
  });

  await runStep('3.2 Exchange Signed Launch Token & Mint SSO Firebase Credentials', async () => {
    assert(sessionToken, 'Session token required');

    // 1. Ensure off-grid-audio is provisioned for tester
    await fetch(`${cleanOplox}/api/auth/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ appId: 'off-grid-audio' }),
    });

    // 2. Exchange launch token
    const res = await fetch(`${cleanOplox}/api/auth/token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ targetAppId: 'off-grid-audio' }),
      signal: AbortSignal.timeout(8000),
    });

    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.launchToken, 'Expected launchToken');
    assert(data.launchUrl, 'Expected launchUrl');
    assert(data.launchUrl.includes('token='), 'Launch URL must include token parameter');
    assert(data.launchUrl.includes('hub='), 'Launch URL must include hub parameter');

    // 3. Perform SSO Mint handshake (as Off-Grid Audio PWA does on load)
    const mintRes = await fetch(`${cleanOplox}/api/auth/sso/off-grid-audio/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssoToken: data.launchToken }),
      signal: AbortSignal.timeout(8000),
    });
    assert.strictEqual(mintRes.status, 200, `Expected 200 from SSO mint, got ${mintRes.status}`);
    const mintData = await mintRes.json();
    assert.strictEqual(mintData.success, true, 'SSO mint must succeed');
    assert(mintData.customToken, 'Must receive Firebase customToken');

    // 4. Query logs to confirm SSO audit activity is captured in Fleet Logs
    const logRes = await fetch(`${cleanOplox}/api/logs?limit=50`);
    const allLogs = await logRes.json();
    const hasSsoAudit = allLogs.some((l) => l.message && l.message.includes('[SSO]'));
    assert(hasSsoAudit, 'Fleet Logs must record [SSO] lifecycle events');
  });

  // --- SECTION 4: LIVE AUDIO WEB NODE HEALTH ---
  await runStep('4.1 Live Off-Grid Audio App Shell Response', async () => {
    const res = await fetch(cleanAudio, {
      headers: { 'User-Agent': 'Mozilla/5.0 Sentinel-Probe' },
      signal: AbortSignal.timeout(10000),
    });
    assert.strictEqual(res.status, 200, `Audio app shell returned ${res.status}`);
    const text = await res.text();
    assert(text.includes('<!DOCTYPE html>') || text.includes('Off-Grid Audio'), 'Must return PWA HTML shell');
  });

  // --- SUMMARY AUDIT TABLE ---
  console.log(`\n----------------------------------------------------------------------`);
  console.log(`📊 SENTINEL OFF-GRID AUDIO & OPLOX TELEMETRY REPORT`);
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
    console.log(`\n🎉 All Off-Grid Audio & Oplox Telemetry Probes Passed with 100% Reliability!`);
    console.log(`----------------------------------------------------------------------\n`);
  }
}

main().catch((err) => {
  console.error('Fatal Test Runner Failure:', err);
  process.exit(1);
});
