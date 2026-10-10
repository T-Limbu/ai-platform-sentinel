#!/usr/bin/env node
/**
 * Sentinel CLI Runner
 * Usage:
 *   node bin/sentinel.js test oplox --env qa
 *   node bin/sentinel.js doctor
 */

import path from 'path';
import { runSentinelDiagnostic, runAutonomousHealingLoop } from '../src/index.js';

const args = process.argv.slice(2);
const command = args[0] || 'doctor';

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const env = getArgValue('--env') || 'qa';
const customUrl = getArgValue('--url');
const shouldHeal = args.includes('--heal');

async function main() {
  console.log(`\n======================================================`);
  console.log(`🛡️  AI PLATFORM SENTINEL: Integration & QA Diagnostic Doctor`);
  console.log(`======================================================`);

  if (command === 'loop' || command === 'heal-loop' || command === 'auto-heal') {
    const service = args[1] || 'oplox';
    let targetUrl = customUrl;

    if (!targetUrl) {
      if (env === 'local') targetUrl = 'http://localhost:5173';
      else if (env === 'qa') targetUrl = `https://ai-platform-${service}-qa.onrender.com`;
      else targetUrl = `https://ai-platform-${service}.onrender.com`;
    }

    const result = await runAutonomousHealingLoop({
      serviceName: service,
      env,
      targetUrl,
      serviceDir: path.resolve(`../${service}`),
      infraRoot: path.resolve('../ai-platform-infra'),
    });

    if (result.report) {
      printSummary(result.report);
    }
    if (!result.success) {
      process.exit(1);
    }
  } else if (command === 'test' || command === 'diagnose') {
    const service = args[1] || 'oplox';
    let targetUrl = customUrl;

    if (!targetUrl) {
      if (env === 'local') targetUrl = 'http://localhost:5173';
      else if (env === 'qa') targetUrl = `https://ai-platform-${service}-qa.onrender.com`;
      else targetUrl = `https://ai-platform-${service}.onrender.com`;
    }

    const report = await runSentinelDiagnostic({
      serviceName: service,
      env,
      targetUrl,
      heal: shouldHeal,
      serviceDir: path.resolve(`../${service}`),
      infraRoot: path.resolve('../ai-platform-infra'),
    });

    printSummary(report);
  } else if (command === 'doctor') {
    console.log(`\n🩺 Running Sentinel Doctor against Local Control Plane...`);
    const report = await runSentinelDiagnostic({
      serviceName: 'oplox',
      env: 'local',
      targetUrl: 'http://localhost:5170',
      routes: ['/nodes', '/logs', '/metrics'],
      apiEndpoints: ['/api/apps', '/api/logs'],
    });

    printSummary(report);
  } else {
    console.log(`\nUsage:`);
    console.log(`  node bin/sentinel.js loop <service-name> [--env qa|prod|local]   (Continuous autonomous heal-loop)`);
    console.log(`  node bin/sentinel.js test <service-name> [--env qa|prod|local] [--heal]`);
    console.log(`  node bin/sentinel.js doctor`);
    process.exit(1);
  }
}

function printSummary(report) {
  console.log(`\n------------------------------------------------------`);
  console.log(`📋 DIAGNOSTIC AUDIT REPORT: ${report.serviceName.toUpperCase()} (${report.env.toUpperCase()})`);
  console.log(`------------------------------------------------------`);
  console.log(`Status:        ${report.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY / ISSUES DETECTED'}`);
  console.log(`Critical:      ${report.criticalCount}`);
  console.log(`Warnings:      ${report.warningCount}`);

  if (report.issues.length === 0) {
    console.log(`\n🎉 Zero integration issues detected! All probes passed cleanly.`);
  } else {
    console.log(`\n⚠️  Detected Integration Invariants:`);
    for (const [idx, issue] of report.issues.entries()) {
      const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'WARNING' ? '🟡' : 'ℹ️';
      console.log(`\n  ${icon} [${issue.code}] ${issue.title}`);
      console.log(`     ${issue.description}`);
      if (issue.rootCause) {
        console.log(`     Root Cause:  ${issue.rootCause}`);
      }
      if (issue.remediation?.length) {
        console.log(`     Remediation:`);
        for (const rem of issue.remediation) {
          console.log(`       -> ${rem}`);
        }
      }
    }
  }

  if (report.healingReport) {
    console.log(`\n------------------------------------------------------`);
    console.log(`🛠️  Autonomous Healing Summary:`);
    console.log(`   Patches Applied: ${report.healingReport.healedCount}`);
    for (const res of report.healingReport.results) {
      console.log(`   • ${res.action} (${res.file})`);
    }
  }
  console.log(`------------------------------------------------------\n`);
}

main().catch((err) => {
  console.error(`Fatal Sentinel Error:`, err);
  process.exit(1);
});
