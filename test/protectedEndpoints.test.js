/**
 * KSH-344: Oplox protects /api/logs and /api/logs/stream (401 without a token). The canary must treat that 401 as a
 * pass for Oplox, fail if the protection disappears, and leave every other service's probes as they were.
 */

import assert from 'assert';
import http from 'http';
import { probeApiEndpoints, probeSseStream } from '../src/probes/canary.js';
import { diagnoseFailures } from '../src/diagnostics/rootCause.js';
import { runSentinelDiagnostic } from '../src/index.js';

console.log('🧪 Running protected-endpoint probe tests (KSH-344)...');

// A stub server: `mode` decides whether the log routes are protected (401) or public (200)
function startStub(mode) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': req.headers.origin || '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }
    if (url === '/api/apps') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([{ id: 'a' }]));
    }
    if (url === '/api/logs') {
      if (mode === 'protected') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Authentication required' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('[]');
    }
    if (url === '/api/logs/stream') {
      if (mode === 'protected') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Authentication required' }));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {}\n\n');
      setTimeout(() => res.end(), 50);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!DOCTYPE html><html><body>ok</body></html>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
const stop = (s) => new Promise((r) => s.server.close(r));

const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

const prot = await startStub('protected');
const open = await startStub('public');

// 1. A 401 passes when 401 is expected
{
  const r = await probeApiEndpoints(prot.url, ['/api/apps', { path: '/api/logs', expect: 401 }]);
  assert.strictEqual(r.allPassed, true, 'protected /api/logs plus public /api/apps should pass');
  assert.strictEqual(r.endpoints[1].statusCode, 401);
  assert.strictEqual(r.endpoints[1].expected, 401);
  console.log('  ✓ 401 on /api/logs passes when 401 is expected');
}

// 2. A 200 fails when 401 is expected: the protection is gone
{
  const r = await probeApiEndpoints(open.url, ['/api/apps', { path: '/api/logs', expect: 401 }]);
  assert.strictEqual(r.allPassed, false);
  assert.strictEqual(r.endpoints[1].passed, false);
  assert.strictEqual(r.endpoints[1].protectionMissing, true, 'a public protected route must be flagged');
  console.log('  ✓ 200 on /api/logs fails when 401 is expected (protectionMissing)');
}

// 3. Plain string endpoints keep their old meaning: 200 plus JSON
{
  const ok = await probeApiEndpoints(open.url, ['/api/apps', '/api/logs']);
  assert.strictEqual(ok.allPassed, true);
  const bad = await probeApiEndpoints(prot.url, ['/api/apps', '/api/logs']);
  assert.strictEqual(bad.allPassed, false, 'a plain /api/logs still has to answer 200');
  assert.strictEqual(bad.endpoints[1].protectionMissing, undefined);
  console.log('  ✓ plain endpoints still need 200 and JSON');
}

// 4. /api/apps is still required to be public JSON
{
  const r = await probeApiEndpoints(prot.url, [{ path: '/api/logs', expect: 401 }, '/api/missing']);
  assert.strictEqual(r.endpoints[0].passed, true);
  assert.strictEqual(r.endpoints[1].passed, false);
  console.log('  ✓ other endpoints are judged independently');
}

// 5. SSE stream
{
  const a = await probeSseStream(prot.url, '/api/logs/stream', 401);
  assert.strictEqual(a.passed, true);
  const b = await probeSseStream(open.url, '/api/logs/stream', 401);
  assert.strictEqual(b.passed, false);
  assert.strictEqual(b.protectionMissing, true);
  const c = await probeSseStream(open.url);
  assert.strictEqual(c.passed, true, 'default: 200 and event-stream, as before');
  const d = await probeSseStream(prot.url);
  assert.strictEqual(d.passed, false, 'default: a 401 is still a failure');
  console.log('  ✓ SSE probe: 401 expected passes, public stream fails, default unchanged');
}

// 6. Diagnosis names the problem
{
  const wake = { awake: true, attempts: 1, statusCode: 200, totalDurationMs: 5, history: [] };
  const bad = diagnoseFailures({
    serviceName: 'oplox', env: 'qa', targetUrl: 'https://x', wakeResult: wake,
    apiResult: { allPassed: false, endpoints: [{ endpoint: '/api/logs', passed: false, statusCode: 200, expected: 401, protectionMissing: true }] },
  });
  assert.strictEqual(bad.isHealthy, false);
  const issue = bad.issues.find((i) => i.code === 'PROTECTED_ENDPOINT_PUBLIC');
  assert(issue, 'should report PROTECTED_ENDPOINT_PUBLIC');
  assert.strictEqual(issue.severity, 'CRITICAL');
  assert.strictEqual(issue.selfHealable, false);
  assert(!bad.issues.some((i) => i.code === 'CORE_API_UNAVAILABLE'), 'not reported as the API being down');

  const sse = diagnoseFailures({
    serviceName: 'oplox', env: 'qa', targetUrl: 'https://x', wakeResult: wake,
    sseResult: { passed: false, endpoint: '/api/logs/stream', statusCode: 200, protectionMissing: true },
  });
  assert(sse.issues.some((i) => i.code === 'PROTECTED_ENDPOINT_PUBLIC'));

  const good = diagnoseFailures({
    serviceName: 'oplox', env: 'qa', targetUrl: 'https://x', wakeResult: wake,
    sseResult: { passed: true, endpoint: '/api/logs/stream', statusCode: 401, expected: 401 },
    apiResult: { allPassed: true, endpoints: [] },
  });
  assert.strictEqual(good.isHealthy, true);
  console.log('  ✓ diagnosis reports PROTECTED_ENDPOINT_PUBLIC, not an API outage');
}

// 7. Whole diagnostic: the Oplox profile is green when protected, red when public; other services are unchanged
{
  const run = (serviceName, target) => quiet(() => runSentinelDiagnostic({ serviceName, env: 'local', targetUrl: target.url, clientOrigin: 'https://ai-platform-oplox-qa.onrender.com' }));

  const oploxProtected = await run('oplox', prot);
  assert.strictEqual(oploxProtected.isHealthy, true, 'Oplox with protected log routes is healthy');
  assert.strictEqual(oploxProtected.sseResult.statusCode, 401);

  const oploxPublic = await run('oplox', open);
  assert.strictEqual(oploxPublic.isHealthy, false, 'Oplox with public log routes is red');
  assert(oploxPublic.issues.some((i) => i.code === 'PROTECTED_ENDPOINT_PUBLIC'));

  const otherPublic = await run('some-other-app', open);
  assert.strictEqual(otherPublic.isHealthy, true, 'other services still expect public log routes');
  const otherProtected = await run('some-other-app', prot);
  assert.strictEqual(otherProtected.isHealthy, false, 'and still fail when they answer 401');
  console.log('  ✓ Oplox profile green when protected, red when public; other services unchanged');
}

await stop(prot);
await stop(open);
console.log('\n🎉 Protected-endpoint tests passed!');
