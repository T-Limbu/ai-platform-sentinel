/**
 * Self-Healing Observer (propose-only)
 *
 * One pass: [Probe] -> [Read Render events] -> [Write a proposed patch] -> stop.
 * The owner reviews and applies the patch. Nothing in the target is edited,
 * committed or pushed, and Render is only ever read.
 */

import { execSync } from 'child_process';
import { runSentinelDiagnostic } from '../index.js';
import { assertHealingAllowed, executeSelfHealing } from './autoPatch.js';

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

// Read-only: prints why the latest deploy failed, if Render says.
async function reportRenderFailure(renderApiKey, serviceName, env) {
  const headers = { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' };
  try {
    console.log(`\n🔍 [Render Telemetry] Querying Render API for deploy events...`);
    const targetSlug = serviceName.startsWith('ai-') ? `${serviceName}-${env}` : `ai-platform-${serviceName}-${env}`;
    const srvRes = await fetch('https://api.render.com/v1/services?limit=50', { headers });
    if (!srvRes.ok) return;

    const services = await srvRes.json();
    const match = services.find((s) => {
      const name = s.service?.name?.toLowerCase();
      const slug = s.service?.slug?.toLowerCase();
      return name === targetSlug.toLowerCase() || slug === targetSlug.toLowerCase() || name === serviceName.toLowerCase();
    });
    if (!match?.service?.id) return;

    const eventsRes = await fetch(`https://api.render.com/v1/services/${match.service.id}/events?limit=5`, { headers });
    if (!eventsRes.ok) return;

    const events = await eventsRes.json();
    const failed = events.find((e) => e.event?.type === 'deploy_ended' && e.event?.details?.deployStatus === 'failed');
    if (failed) {
      console.log(`   🚨 Detected Render Failure Reason:`, JSON.stringify(failed.event?.details?.reason));
    }
  } catch (err) {
    console.warn(`   Could not query Render API events: ${err.message}`);
  }
}

export async function runAutonomousHealingLoop({
  serviceName = 'oplox',
  env = 'qa',
  targetUrl,
  serviceDir,
  proposalsRoot,
  runDiagnostic = runSentinelDiagnostic,
}) {
  assertHealingAllowed(env);

  console.log(`\n======================================================`);
  console.log(`🔄 [Sentinel] Self-Healing Observer (propose-only)`);
  console.log(`   Target Service: ${serviceName} (${env.toUpperCase()})`);
  console.log(`   Service Path:   ${serviceDir}`);
  console.log(`======================================================\n`);

  const report = await runDiagnostic({ serviceName, env, targetUrl, serviceDir, heal: false });

  if (report.isHealthy) {
    console.log(`\n🎉 Service '${serviceName}' is healthy. Nothing to propose.`);
    return { success: true, iterations: 1, report };
  }

  console.log(`\n❌ [Diagnostic Detected ${report.criticalCount} Critical Issue(s)]`);
  for (const issue of report.issues) {
    console.log(`   • [${issue.code}] ${issue.title}`);
  }

  const renderApiKey = getRenderApiKey();
  if (renderApiKey) await reportRenderFailure(renderApiKey, serviceName, env);

  let healingReport;
  try {
    healingReport = await executeSelfHealing(report, serviceDir, { serviceName, env, proposalsRoot });
  } catch (err) {
    console.error(`   ❌ Could not write a proposal: ${err.message}`);
    return { success: false, error: err.message, report };
  }

  if (!healingReport.proposal) {
    console.log(`\nℹ️  No self-healable issues. Nothing was proposed.`);
    return { success: false, error: 'No self-healable issues', report };
  }

  return { success: false, proposal: healingReport.proposal, report: { ...report, healingReport } };
}
