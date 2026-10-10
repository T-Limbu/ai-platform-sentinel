/**
 * ai-platform-sentinel
 * Main diagnostic and self-healing runner API
 */

import path from 'path';
import { wakeUpNode, probeCors, probeSpaRouting, probeSseStream, probeApiEndpoints } from './probes/canary.js';
import { diagnoseFailures } from './diagnostics/rootCause.js';
import { executeSelfHealing } from './healer/autoPatch.js';

export async function runSentinelDiagnostic({
  serviceName = 'oplox',
  env = 'qa',
  targetUrl,
  serviceDir,
  infraRoot,
  clientOrigin = 'https://ai-platform-oplox-qa.onrender.com',
  heal = false,
  routes = ['/nodes', '/logs', '/metrics'],
  apiEndpoints = ['/api/apps', '/api/logs'],
}) {
  if (!targetUrl) {
    targetUrl = env === 'local' ? 'http://localhost:5173' : `https://${serviceName}-${env}.onrender.com`;
  }

  console.log(`\n🔍 [Sentinel] Initiating diagnostic battery on ${serviceName} (${env.toUpperCase()})`);
  console.log(`   Target URL: ${targetUrl}`);

  // Step 1: Wake-up / Cold-start canary
  console.log(`   [1/5] Probing availability & Render container wake-up...`);
  const wakeResult = await wakeUpNode(targetUrl, { maxAttempts: 5, intervalMs: 3000 });

  let corsResult = null;
  let spaResult = null;
  let sseResult = null;
  let apiResult = null;

  if (wakeResult.awake) {
    console.log(`   ✅ Node responded with HTTP ${wakeResult.statusCode} in ${wakeResult.attempts} attempt(s).`);

    // Step 2: CORS Preflight
    console.log(`   [2/5] Validating CORS policy for origin '${clientOrigin}'...`);
    corsResult = await probeCors(targetUrl, clientOrigin);

    // Step 3: SPA Routing Deep Links
    console.log(`   [3/5] Verifying SPA catch-all routing fallback...`);
    spaResult = await probeSpaRouting(targetUrl, routes);

    // Step 4: Real-time SSE Stream
    console.log(`   [4/5] Probing SSE log stream handshake...`);
    sseResult = await probeSseStream(targetUrl);

    // Step 5: Core API Health
    console.log(`   [5/5] Testing JSON API endpoints...`);
    apiResult = await probeApiEndpoints(targetUrl, apiEndpoints);
  } else {
    console.log(`   ❌ Node is unreachable (status: ${wakeResult.statusCode}). Skipping higher-level probes.`);
  }

  // Step 6: Root Cause Diagnostic Analysis
  const diagnosis = diagnoseFailures({
    serviceName,
    env,
    targetUrl,
    wakeResult,
    corsResult,
    spaResult,
    sseResult,
    apiResult,
    infraRoot: infraRoot || path.resolve('../ai-platform-infra'),
  });

  // Step 7: Autonomous Self-Healing (if enabled)
  let healingReport = null;
  if (heal && !diagnosis.isHealthy && serviceDir) {
    console.log(`\n🛠️ [Sentinel] Engaging Autonomous Self-Healing Loop...`);
    healingReport = executeSelfHealing(diagnosis, serviceDir, infraRoot);
  }

  return {
    ...diagnosis,
    wakeResult,
    corsResult,
    spaResult,
    sseResult,
    apiResult,
    healingReport,
  };
}
