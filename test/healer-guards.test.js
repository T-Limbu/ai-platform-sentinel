/**
 * Safety guards for self-healing: propose-only, never prod, never a remote write.
 * No real network and no real service checkout: fetch is stubbed and every
 * target is a throwaway git repo under the OS temp directory.
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

// Set before any sentinel module loads, so the real key is never read.
process.env.RENDER_API_KEY = 'fake-test-key';
const proposalsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-proposals-'));
process.env.SENTINEL_PROPOSALS_DIR = proposalsRoot;

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), method: (options.method || 'GET').toUpperCase() });
  const body = String(url).includes('/v1/services?')
    ? [{ service: { id: 'srv-test', name: 'ai-platform-oplox-qa' } }]
    : [];
  return { ok: true, status: 200, headers: new Map(), json: async () => body, text: async () => '' };
};

const autoPatch = await import('../src/healer/autoPatch.js');
const { runAutonomousHealingLoop } = await import('../src/healer/healingLoop.js');
const { runSentinelDiagnostic } = await import('../src/index.js');
const { diagnoseFailures } = await import('../src/diagnostics/rootCause.js');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFUSAL = /Sentinel healing is disabled for prod/;

const SERVER = `import express from 'express';
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('up'));
`;

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'server/index.js'), SERVER);
  fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "fixture",\n  "devDependencies": {\n    "vite": "^5.0.0"\n  }\n}\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'branch', 'dev');
  return dir;
}

function snapshot(dir) {
  const out = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(dir);
  return { files: out, refs: git(dir, 'for-each-ref', '--format=%(refname) %(objectname)') };
}

const diagnosis = (...healActions) => ({
  serviceName: 'oplox',
  env: 'qa',
  isHealthy: false,
  criticalCount: 1,
  warningCount: 0,
  issues: healActions.map((healAction) => ({
    code: healAction,
    title: healAction,
    severity: 'CRITICAL',
    selfHealable: true,
    healAction,
  })),
});

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('guard refuses prod in any case and allows qa, local and no env', () => {
  for (const env of ['prod', 'PROD', ' prod ']) assert.throws(() => autoPatch.assertHealingAllowed(env), REFUSAL);
  for (const env of ['qa', 'local', undefined]) autoPatch.assertHealingAllowed(env);
});

test('every healing entry point refuses prod before any request or write', async () => {
  const dir = makeService();
  const before = snapshot(dir);
  requests.length = 0;
  let probed = false;
  await assert.rejects(
    runAutonomousHealingLoop({ env: 'prod', serviceDir: dir, maxIterations: 1, runDiagnostic: async () => { probed = true; } }),
    REFUSAL,
  );
  await assert.rejects(async () => autoPatch.executeSelfHealing(diagnosis('patch_spa_fallback'), dir, { env: 'prod' }), REFUSAL);
  await assert.rejects(runSentinelDiagnostic({ env: 'prod', heal: true, serviceDir: dir }), REFUSAL);
  await assert.rejects(async () => autoPatch.healRenderDeployment(dir, 'oplox', 'prod'), REFUSAL);
  assert.strictEqual(probed, false);
  assert.deepStrictEqual(requests, []);
  assert.deepStrictEqual(snapshot(dir), before);
});

test('healRenderDeployment sends no request that can change Render and writes nothing', async () => {
  const dir = makeService();
  const before = snapshot(dir);
  requests.length = 0;
  const result = await autoPatch.healRenderDeployment(dir, 'oplox', 'qa');
  assert.deepStrictEqual(requests.filter((r) => r.method !== 'GET'), []);
  assert.strictEqual(result.healed, true);
  assert.deepStrictEqual(snapshot(dir), before);
});

test('healSpaRouting proposes the fallback without writing it', () => {
  const dir = makeService();
  const before = snapshot(dir);
  assert.strictEqual(autoPatch.healSpaRouting(dir).healed, true);
  assert.deepStrictEqual(snapshot(dir), before);
});

test('healing writes a patch outside the target that git can apply', async () => {
  const dir = makeService();
  const before = snapshot(dir);
  const report = await autoPatch.executeSelfHealing(
    diagnosis('patch_render_deployment', 'patch_spa_fallback'),
    dir,
    { serviceName: 'oplox', env: 'qa' },
  );
  assert.deepStrictEqual(snapshot(dir), before, 'target must be untouched');
  const { proposal } = report;
  assert(proposal, 'a proposal is returned');
  assert(!path.resolve(proposal.dir).startsWith(path.resolve(dir) + path.sep));
  assert(fs.existsSync(proposal.planPath));
  git(dir, 'apply', proposal.patchPath);
  const server = fs.readFileSync(path.join(dir, 'server/index.js'), 'utf-8');
  assert(server.includes('SPA Fallback'), 'SPA change is in the patch');
  assert(server.includes('/api/health'), 'health change to the same file is kept');
  assert(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).engines.node);
  assert.deepStrictEqual(proposal.files.slice().sort(), ['package.json', 'server/index.js']);
});

test('loop leaves a dirty checkout, its branches and the remote alone', async () => {
  const dir = makeService();
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'unrelated work');
  const before = snapshot(dir);
  requests.length = 0;
  const result = await runAutonomousHealingLoop({
    serviceName: 'oplox',
    env: 'qa',
    serviceDir: dir,
    maxIterations: 1,
    pollIntervalMs: 1,
    maxDeployWaitMs: 5,
    runDiagnostic: async () => diagnosis('patch_spa_fallback'),
  });
  assert.strictEqual(result.success, false);
  assert(result.proposal, 'ends with a proposal');
  assert.deepStrictEqual(snapshot(dir), before);
  assert.deepStrictEqual(requests.filter((r) => r.method !== 'GET'), []);
});

test('loop ends at once when nothing is healable', async () => {
  const dir = makeService();
  const started = Date.now();
  const result = await runAutonomousHealingLoop({
    env: 'qa',
    serviceDir: dir,
    maxIterations: 1,
    pollIntervalMs: 1,
    maxDeployWaitMs: 5,
    runDiagnostic: async () => diagnosis(),
  });
  assert.strictEqual(result.error, 'No self-healable issues');
  assert(Date.now() - started < 1000);
});

test('blocked CORS is reported, never healed', async () => {
  const origin = 'https://ai-platform-oplox-qa.onrender.com';
  const found = diagnoseFailures({
    serviceName: 'x',
    env: 'qa',
    wakeResult: { awake: true },
    corsResult: { passed: false, testedOrigin: origin },
  });
  const issue = found.issues.find((i) => i.code === 'CORS_ORIGIN_BLOCKED');
  assert.strictEqual(issue.selfHealable, false);
  assert.strictEqual(issue.healAction, undefined);
  assert(issue.remediation.join(' ').includes(origin));
  assert(!issue.remediation.join(' ').includes("'*'"));
  assert.strictEqual(autoPatch.healCorsIssue, undefined);
});

test('a proposals folder inside the target is refused', async () => {
  const dir = makeService();
  const before = snapshot(dir);
  await assert.rejects(
    async () => autoPatch.executeSelfHealing(diagnosis('patch_spa_fallback'), dir, {
      env: 'qa',
      proposalsRoot: path.join(dir, 'proposals'),
    }),
    /outside the service/,
  );
  assert.deepStrictEqual(snapshot(dir), before);
});

test('CLI exits 2 for prod healing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-cli-'));
  const preload = path.join(cwd, 'no-network.mjs');
  fs.writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('network used'); };\n");
  for (const args of [['loop', 'none', '--env', 'prod'], ['test', 'none', '--env', 'PROD', '--heal']]) {
    const run = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(preload).href, path.join(repoRoot, 'bin/sentinel.js'), ...args],
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );
    assert.strictEqual(run.status, 2, `${args.join(' ')} exited ${run.status}`);
    assert.match(run.stdout + run.stderr, REFUSAL);
  }
});

console.log('🧪 Running Sentinel Healer Guard Tests...');
let failed = 0;
const log = console.log;
for (const { name, fn } of tests) {
  console.log = () => {};
  console.warn = () => {};
  try {
    await fn();
    log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    log(`  ✗ ${name}: ${err.message.split('\n')[0].slice(0, 160)}`);
  } finally {
    console.log = log;
  }
}
console.log(failed ? `\n❌ ${failed}/${tests.length} guard tests failed` : `\n🎉 All ${tests.length} guard tests passed`);
process.exit(failed ? 1 : 0);
