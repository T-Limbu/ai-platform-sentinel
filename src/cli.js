#!/usr/bin/env node
/**
 * ai-platform-sentinel CLI
 * Usage:
 *   node src/cli.js --service <name> --env <local|qa|prod> [--url <url>] [--heal]
 */

import { runSentinelDiagnostic } from './index.js';

const args = process.argv.slice(2);
function getArg(key, defaultValue = null) {
  const idx = args.indexOf(`--${key}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const serviceName = getArg('service', 'oplox');
const env = getArg('env', 'qa');
const targetUrl = getArg('url', null);
const heal = args.includes('--heal');

async function main() {
  console.log(`🛡️  [Sentinel CLI] Initializing diagnostic run for: ${serviceName} (${env.toUpperCase()})`);
  const report = await runSentinelDiagnostic({
    serviceName,
    env,
    targetUrl,
    heal,
  });

  console.log(`\n======================================================`);
  console.log(`📋 Sentinel Diagnostic Report: ${report.serviceName} (${report.env.toUpperCase()})`);
  console.log(`   Timestamp:      ${report.timestamp}`);
  console.log(`   Overall Health: ${report.isHealthy ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Issues Found:   ${report.findings.length} (${report.criticalCount} critical)`);

  if (report.findings.length > 0) {
    console.log(`\n🔍 Findings:`);
    for (const f of report.findings) {
      console.log(`   [${f.severity.toUpperCase()}] ${f.type}: ${f.message}`);
      console.log(`      💡 Fix: ${f.recommendation}`);
    }
  }

  if (report.remediationLog && report.remediationLog.length > 0) {
    console.log(`\n🔧 Self-Healing Remediation Actions:`);
    for (const log of report.remediationLog) {
      console.log(`   ${log.applied ? '✅' : '❌'} ${log.action} - ${log.details}`);
    }
  }
  console.log(`======================================================\n`);

  process.exit(report.isHealthy ? 0 : 1);
}

main().catch((err) => {
  console.error(`💥 Sentinel fatal error:`, err);
  process.exit(1);
});
