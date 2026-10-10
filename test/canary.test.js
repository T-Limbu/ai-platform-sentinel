/**
 * Canary test suite for ai-platform-sentinel
 */

import assert from 'assert';
import { diagnoseFailures } from '../src/diagnostics/rootCause.js';

console.log('🧪 Running Sentinel Diagnostic Unit Tests...');

// Test 1: Classifies Render sleep / timeout
{
  const diagnosis = diagnoseFailures({
    serviceName: 'test-app',
    env: 'qa',
    targetUrl: 'https://test-app-qa.onrender.com',
    wakeResult: { awake: false, attempts: 5, statusCode: 502, totalDurationMs: 30000, history: [] },
  });

  assert.strictEqual(diagnosis.isHealthy, false, 'Should flag unhealthy');
  assert.strictEqual(diagnosis.criticalCount, 1, 'Should have 1 critical');
  assert.strictEqual(diagnosis.issues[0].code, 'RENDER_COLD_START_OR_CRASH');
  console.log('  ✓ Test 1: Correctly classifies RENDER_COLD_START_OR_CRASH');
}

// Test 2: Classifies CORS origin blocked
{
  const diagnosis = diagnoseFailures({
    serviceName: 'test-api',
    env: 'qa',
    targetUrl: 'https://test-api-qa.onrender.com',
    wakeResult: { awake: true, attempts: 1, statusCode: 200, totalDurationMs: 120, history: [] },
    corsResult: { passed: false, testedOrigin: 'https://oplox-qa.onrender.com', allowOrigin: null },
  });

  assert.strictEqual(diagnosis.isHealthy, false, 'Should flag CORS issue');
  const corsIssue = diagnosis.issues.find((i) => i.code === 'CORS_ORIGIN_BLOCKED');
  assert(corsIssue, 'Should detect CORS_ORIGIN_BLOCKED');
  assert.strictEqual(corsIssue.selfHealable, true, 'CORS should be self-healable');
  console.log('  ✓ Test 2: Correctly classifies CORS_ORIGIN_BLOCKED with selfHealable flag');
}

// Test 3: Classifies SPA routing fallback missing
{
  const diagnosis = diagnoseFailures({
    serviceName: 'test-spa',
    env: 'qa',
    targetUrl: 'https://test-spa-qa.onrender.com',
    wakeResult: { awake: true, attempts: 1, statusCode: 200, totalDurationMs: 100, history: [] },
    spaResult: { allPassed: false, routes: [{ route: '/nodes', passed: false, statusCode: 404 }] },
  });

  const spaIssue = diagnosis.issues.find((i) => i.code === 'SPA_ROUTING_FALLBACK_MISSING');
  assert(spaIssue, 'Should detect SPA_ROUTING_FALLBACK_MISSING');
  console.log('  ✓ Test 3: Correctly classifies SPA_ROUTING_FALLBACK_MISSING');
}

console.log('\n🎉 All Sentinel Canary Tests Passed!');
