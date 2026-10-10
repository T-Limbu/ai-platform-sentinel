/**
 * Autonomous Self-Healing Observer & Remediation Loop
 *
 * Implements the continuous feedback cycle:
 * [Render Log / Telemetry] -> [Diagnose Root Cause] -> [Apply Code/Config Patch] ->
 * [Local Gatekeeper] -> [Git Push] -> [Deploy via Render API] ->
 * [Observer / Poll Live State] -> [Repeat until all Canary Probes Pass Green]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { runSentinelDiagnostic } from '../index.js';
import { healRenderDeployment, healCorsIssue, healSpaRouting } from './autoPatch.js';

export function getRenderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  if (process.platform === 'win32') {
    try {
      const out = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'RENDER_API_KEY\', \'User\')"', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) {
        process.env.RENDER_API_KEY = out;
        return out;
      }
    } catch (e) {}
  }
  return null;
}

export async function runAutonomousHealingLoop({
  serviceName = 'oplox',
  env = 'qa',
  targetUrl,
  serviceDir,
  infraRoot,
  maxIterations = 5,
  pollIntervalMs = 15000,
  maxDeployWaitMs = 180000,
}) {
  console.log(`\n======================================================`);
  console.log(`🔄 [Sentinel] Autonomous Self-Healing & Observer Loop Started`);
  console.log(`   Target Service: ${serviceName} (${env.toUpperCase()})`);
  console.log(`   Service Path:   ${serviceDir}`);
  console.log(`   Max Iterations: ${maxIterations}`);
  console.log(`======================================================\n`);

  const renderApiKey = getRenderApiKey();
  if (!renderApiKey) {
    console.warn(`⚠️  Warning: RENDER_API_KEY environment variable not detected.`);
    console.warn(`   Loop will patch local files and git push, but direct Render API polling/triggers will be limited.`);
  } else {
    console.log(`🔑 [Render API] Authenticated with Render cloud management key.`);
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.log(`\n▶️  [Iteration ${iteration}/${maxIterations}] Executing Diagnostic Probes...`);

    // 1. Run diagnostic battery
    const report = await runSentinelDiagnostic({
      serviceName,
      env,
      targetUrl,
      serviceDir,
      infraRoot,
      heal: false,
    });

    if (report.isHealthy) {
      console.log(`\n🎉 [Self-Healing Success] Service '${serviceName}' is 100% HEALTHY!`);
      console.log(`   All canary probes (Availability, CORS, SPA, SSE, API) passed cleanly.`);
      return { success: true, iterations: iteration, report };
    }

    console.log(`\n❌ [Diagnostic Detected ${report.criticalCount} Critical Issue(s)]`);
    for (const issue of report.issues) {
      console.log(`   • [${issue.code}] ${issue.title}`);
    }

    // 2. Fetch live Render build/deploy error telemetry if available
    let renderFailureReason = null;
    let renderServiceId = null;

    if (renderApiKey) {
      try {
        console.log(`\n🔍 [Render Telemetry] Querying Render API for deploy logs & events...`);
        const targetSlug = serviceName.startsWith('ai-') ? `${serviceName}-${env}` : `ai-platform-${serviceName}-${env}`;
        const srvRes = await fetch('https://api.render.com/v1/services?limit=50', {
          headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
        });

        if (srvRes.ok) {
          const services = await srvRes.json();
          const match = services.find((s) => {
            const name = s.service?.name?.toLowerCase();
            const slug = s.service?.slug?.toLowerCase();
            return name === targetSlug.toLowerCase() || slug === targetSlug.toLowerCase() || name === serviceName.toLowerCase();
          });

          if (match?.service?.id) {
            renderServiceId = match.service.id;
            const eventsRes = await fetch(`https://api.render.com/v1/services/${renderServiceId}/events?limit=5`, {
              headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
            });
            if (eventsRes.ok) {
              const events = await eventsRes.json();
              const failedEvent = events.find((e) => e.event?.type === 'deploy_ended' && e.event?.details?.deployStatus === 'failed');
              if (failedEvent) {
                renderFailureReason = failedEvent.event?.details?.reason;
                console.log(`   🚨 Detected Render Failure Reason:`, JSON.stringify(renderFailureReason));
              }
            }
          }
        }
      } catch (err) {
        console.warn(`   Could not query Render API events: ${err.message}`);
      }
    }

    // 3. Apply targeted remediation in the repository
    console.log(`\n🛠️  [Remediation Patcher] Applying fixes in repository...`);
    const patchActions = [];

    // Apply Render deployment hardening (dependencies, host binding, health probes)
    const renderPatch = await healRenderDeployment(serviceDir, serviceName, env);
    if (renderPatch.healed) {
      patchActions.push(...renderPatch.actions);
    }

    // Apply CORS fix if needed
    const corsIssue = report.issues.find((i) => i.code === 'CORS_ORIGIN_BLOCKED');
    if (corsIssue) {
      const corsPatch = healCorsIssue(serviceDir);
      if (corsPatch.healed) patchActions.push(corsPatch.action);
    }

    // Apply SPA fallback fix if needed
    const spaIssue = report.issues.find((i) => i.code === 'SPA_ROUTING_FALLBACK_MISSING');
    if (spaIssue) {
      const spaPatch = healSpaRouting(serviceDir);
      if (spaPatch.healed) patchActions.push(spaPatch.action);
    }

    console.log(`   Patches applied: ${patchActions.length}`);
    for (const action of patchActions) {
      console.log(`   • ${action}`);
    }

    // 4. Local Verification Gatekeeper
    console.log(`\n🧪 [Gatekeeper] Verifying local test & build integrity...`);
    try {
      if (fs.existsSync(path.join(serviceDir, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(serviceDir, 'package.json'), 'utf-8'));
        if (pkg.scripts?.test) {
          execSync('npm test', { cwd: serviceDir, stdio: 'pipe' });
          console.log(`   ✓ Local tests passed.`);
        }
        if (pkg.scripts?.build) {
          execSync('npm run build', { cwd: serviceDir, stdio: 'pipe' });
          console.log(`   ✓ Local production build succeeded.`);
        }
      }
    } catch (testErr) {
      console.error(`   ❌ Local gatekeeper verification failed: ${testErr.message}`);
      console.error(`   Halting loop before push to prevent publishing broken code.`);
      return { success: false, error: 'Local gatekeeper failed', iteration };
    }

    // 5. Git Commit & Push
    console.log(`\n🚀 [GitOps] Committing and pushing self-healing patch to remote...`);
    try {
      const statusOut = execSync('git status --porcelain', { cwd: serviceDir, encoding: 'utf-8' });
      if (statusOut.trim().length > 0) {
        execSync('git add -A', { cwd: serviceDir, stdio: 'pipe' });
        execSync(`git commit -m "fix(self-heal): automated remediation patch [iteration ${iteration}]"`, { cwd: serviceDir, stdio: 'pipe' });
        execSync('git push origin dev', { cwd: serviceDir, stdio: 'pipe' });
        console.log(`   ✓ Pushed commit to origin/dev.`);
      } else {
        console.log(`   ℹ️  Working tree clean (no new file changes to push).`);
      }
    } catch (gitErr) {
      console.warn(`   Git commit/push note: ${gitErr.message || 'Already committed'}`);
    }

    // 6. Trigger Render deployment if needed
    if (renderApiKey && renderServiceId) {
      try {
        console.log(`\n☁️  [Render Deployer] Triggering deploy with clean cache...`);
        await fetch(`https://api.render.com/v1/services/${renderServiceId}/deploys`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${renderApiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clearCache: 'clear' }),
        });
        console.log(`   ✓ Deploy triggered via Render REST API.`);
      } catch (deployErr) {
        console.warn(`   Could not trigger deploy via API: ${deployErr.message}`);
      }
    }

    // 7. Observer Mode: Poll Render deployment until live or failed
    if (renderApiKey && renderServiceId) {
      console.log(`\n👀 [Observer Mode] Polling Render deploy until LIVE (timeout: ${Math.round(maxDeployWaitMs / 1000)}s)...`);
      const startTime = Date.now();
      let isLive = false;

      while (Date.now() - startTime < maxDeployWaitMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        try {
          const deployRes = await fetch(`https://api.render.com/v1/services/${renderServiceId}/deploys?limit=1`, {
            headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
          });
          if (deployRes.ok) {
            const deploys = await deployRes.json();
            const latest = deploys[0]?.deploy;
            const status = latest?.status;
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`   [+${elapsed}s] Deploy ${latest?.id} status: ${status?.toUpperCase()}`);

            if (status === 'live') {
              console.log(`   ✅ Deploy is LIVE on Render!`);
              isLive = true;
              break;
            } else if (status === 'build_failed' || status === 'update_failed') {
              console.log(`   ❌ Deploy failed on Render. Analyzing next iteration...`);
              break;
            }
          }
        } catch (e) {
          console.warn(`   Polling error: ${e.message}`);
        }
      }

      if (!isLive) {
        console.log(`   Deploy not live yet. Retrying loop cycle...`);
        continue;
      }
    } else {
      console.log(`\n⏳ Waiting 45s for cloud container spin-up before re-probing...`);
      await new Promise((r) => setTimeout(r, 45000));
    }
  }

  console.log(`\n⚠️  [Self-Healing] Reached maximum iterations (${maxIterations}) without full green resolution.`);
  return { success: false, maxIterationsReached: true };
}
