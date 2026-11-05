import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  LAYOUT_MODULE, parseLayoutArgs, waitForHealth, buildQaConfig, fetchLayoutModule, sha256, runLayoutCheck,
} from '../src/layout/layoutCheck.js';

console.log('🧪 Running layout-check command tests...');

{
  const a = parseLayoutArgs(['layout', 'oplox', '--env', 'qa', '--report-only']);
  assert.deepStrictEqual([a.app, a.env, a.reportOnly, a.healthTimeoutMs], ['oplox', 'qa', true, 180000]);
  assert.strictEqual(parseLayoutArgs(['layout']).app, 'oplox');
  console.log('  ✓ parses args');
}
{
  const cfg = { baseUrl: 'http://localhost:5170', login: { userEnv: 'X', passEnv: 'Y', apiPath: '/a' }, pages: [] };
  const out = buildQaConfig(cfg, { baseUrl: 'https://qa' });
  assert.strictEqual(out.baseUrl, 'https://qa');
  assert.strictEqual(out.login.userEnv, 'SENTINEL_QA_USER');
  assert.strictEqual(cfg.baseUrl, 'http://localhost:5170', 'input not mutated');
  console.log('  ✓ buildQaConfig retargets baseUrl and login env names');
}
{
  let t = 0, calls = 0;
  const r = await waitForHealth('u', {
    now: () => t, sleepFn: async (ms) => { t += ms; },
    fetchFn: async () => (++calls < 4 ? { ok: false, status: 503 } : { ok: true }),
  });
  assert.deepStrictEqual([r.ok, r.attempts], [true, 4]);
  console.log('  ✓ waitForHealth survives cold start (503s then 200)');
}
{
  let t = 0;
  const r = await waitForHealth('u', { timeoutMs: 20000, now: () => t, sleepFn: async (ms) => { t += ms; }, fetchFn: async () => { throw new Error('x'); } });
  assert.strictEqual(r.ok, false);
  console.log('  ✓ waitForHealth gives up after timeout');
}
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'));
  await assert.rejects(fetchLayoutModule({ cacheDir: dir, fetchFn: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('evil') }) }), /hash mismatch/);
  const good = Buffer.from('good');
  const orig = LAYOUT_MODULE.sha256;
  LAYOUT_MODULE.sha256 = sha256(good);
  const p = await fetchLayoutModule({ cacheDir: dir, fetchFn: async () => ({ ok: true, arrayBuffer: async () => good }) });
  assert.strictEqual(fs.readFileSync(p, 'utf8'), 'good');
  assert.strictEqual(await fetchLayoutModule({ cacheDir: dir, fetchFn: async () => { throw new Error('should use cache'); } }), p);
  LAYOUT_MODULE.sha256 = orig;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ✓ module download is hash-pinned and cached');
}
{
  await assert.rejects(runLayoutCheck({ app: 'nope', env: 'qa' }), /unknown app/);
  await assert.rejects(runLayoutCheck({ app: 'oplox', env: 'prod' }), /only runs against QA/);
  delete process.env.SENTINEL_QA_PASSWORD;
  await assert.rejects(runLayoutCheck({ app: 'oplox', env: 'qa' }), /SENTINEL_QA_PASSWORD/);
  process.env.SENTINEL_QA_PASSWORD = 'x';
  await assert.rejects(runLayoutCheck({ app: 'oplox', env: 'qa', healthTimeoutMs: 1 }, { waitForHealth: async () => ({ ok: false, waitedMs: 1, last: 'HTTP 503' }) }), /not healthy/);
  const mod = path.join(os.tmpdir(), 'fake-layout-mod.mjs');
  fs.writeFileSync(mod, 'import fs from "fs"; export async function run(p,{reportOnly}){ const c=JSON.parse(fs.readFileSync(p,"utf8")); return c.baseUrl==="https://qa.example"&&c.login.passEnv==="SENTINEL_QA_PASSWORD"?(reportOnly?0:1):99; }');
  const deps = {
    waitForHealth: async () => ({ ok: true, attempts: 1, waitedMs: 10 }),
    fetchAppConfig: async () => JSON.stringify({ baseUrl: 'x', login: { userEnv: 'a', passEnv: 'b' }, pages: [] }),
    fetchLayoutModule: async () => mod,
  };
  assert.strictEqual(await runLayoutCheck({ app: 'oplox', env: 'qa', url: 'https://qa.example' }, deps), 1);
  assert.strictEqual(await runLayoutCheck({ app: 'oplox', env: 'qa', url: 'https://qa.example', reportOnly: true }, deps), 0);
  fs.rmSync(mod);
  delete process.env.SENTINEL_QA_PASSWORD;
  console.log('  ✓ runLayoutCheck orchestrates health, config and exit code (error vs report-only)');
}
console.log('✅ layout-check tests passed');
