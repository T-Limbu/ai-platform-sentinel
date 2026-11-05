/**
 * `sentinel layout <app> --env qa`: post-deploy responsive layout check (stage 3).
 *
 * The check itself is the shared module in T-Limbu/ai-platform-workflows. It is fetched at a
 * pinned tag and verified against a pinned SHA-256, so there is no copy to drift and a moved
 * tag or tampered download fails loudly. Bumping the version means bumping both constants.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { pathToFileURL } from 'url';

export const LAYOUT_MODULE = {
  repo: 'T-Limbu/ai-platform-workflows',
  tag: 'v1.1.0',
  file: 'layout-check/layout-check.mjs',
  sha256: '782832d8e3373c1e83e52092031bd8d23e8bbce76bc64053eab8b8b8dfcd7b9e',
};

// Per-app registry. configRepo/configPath are read from GitHub (the app repos are private).
export const LAYOUT_APPS = {
  oplox: {
    qaUrl: 'https://ai-platform-oplox-qa.onrender.com',
    healthPath: '/api/health',
    configRepo: 'T-Limbu/ai-platform-oplox',
    configPath: 'layout-check/oplox.layout.json',
    configRef: 'main',
  },
};

// Login for the existing seeded QA account. The password is never stored in this repo.
export const QA_USER_ENV = 'SENTINEL_QA_USER'; // default: sentinel_tester
export const QA_PASS_ENV = 'SENTINEL_QA_PASSWORD';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function parseLayoutArgs(args) {
  const val = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
  };
  return {
    app: args[1] && !args[1].startsWith('--') ? args[1] : 'oplox',
    env: val('--env') || 'qa',
    url: val('--url'),
    config: val('--config'),
    reportOnly: args.includes('--report-only'),
    healthTimeoutMs: Number(val('--health-timeout') || 180) * 1000,
  };
}

/** Poll the health URL until 200, tolerating the ~50 s Render cold start. */
export async function waitForHealth(url, { timeoutMs = 180000, intervalMs = 5000, fetchFn = fetch, sleepFn = sleep, now = Date.now } = {}) {
  const start = now();
  let attempts = 0;
  let last = 'no response';
  while (now() - start <= timeoutMs) {
    attempts++;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return { ok: true, attempts, waitedMs: now() - start };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code || e.name || 'network error';
    }
    await sleepFn(intervalMs);
  }
  return { ok: false, attempts, waitedMs: now() - start, last };
}

/** Download the pinned shared module (cached by hash) and return its path. */
export async function fetchLayoutModule({ fetchFn = fetch, cacheDir = path.join(os.tmpdir(), 'sentinel-layout-check') } = {}) {
  const cached = path.join(cacheDir, `${LAYOUT_MODULE.tag}-${LAYOUT_MODULE.sha256.slice(0, 12)}.mjs`);
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === LAYOUT_MODULE.sha256) return cached;
  const url = `https://raw.githubusercontent.com/${LAYOUT_MODULE.repo}/${LAYOUT_MODULE.tag}/${LAYOUT_MODULE.file}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`could not fetch layout module (${res.status}) from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== LAYOUT_MODULE.sha256) throw new Error(`layout module hash mismatch for ${LAYOUT_MODULE.tag}: expected ${LAYOUT_MODULE.sha256}, got ${got}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, buf);
  return cached;
}

/** Read the app's layout config from its (private) repo with the local gh login. */
export function fetchAppConfig(app, { exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    exec('gh', ['api', `repos/${app.configRepo}/contents/${app.configPath}?ref=${app.configRef}`, '-H', 'Accept:application/vnd.github.raw+json'],
      { maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => (err ? reject(new Error(`could not read ${app.configRepo}/${app.configPath} via gh (${err.message.split('\n')[0]}); pass --config <file> instead`)) : resolve(stdout)));
  });
}

/** Point the app config at QA and make it use the Sentinel env-var names for the login. */
export function buildQaConfig(cfg, { baseUrl }) {
  const out = { ...cfg, baseUrl };
  if (cfg.login) out.login = { ...cfg.login, userEnv: QA_USER_ENV, passEnv: QA_PASS_ENV };
  return out;
}

export async function runLayoutCheck(opts, deps = {}) {
  const { env, reportOnly } = opts;
  const app = LAYOUT_APPS[opts.app];
  if (!app) throw new Error(`unknown app "${opts.app}" (known: ${Object.keys(LAYOUT_APPS).join(', ')})`);
  if (env !== 'qa') throw new Error('sentinel layout only runs against QA (--env qa); it signs in with a QA-only test account');
  const baseUrl = opts.url || app.qaUrl;

  process.env[QA_USER_ENV] ||= 'sentinel_tester';
  if (!process.env[QA_PASS_ENV]) throw new Error(`set ${QA_PASS_ENV} (password of the seeded QA test account)`);

  console.log(`⏳ Waiting for ${baseUrl}${app.healthPath} (QA cold start can take ~50 s)...`);
  const health = await (deps.waitForHealth || waitForHealth)(baseUrl + app.healthPath, { timeoutMs: opts.healthTimeoutMs });
  if (!health.ok) throw new Error(`${baseUrl} not healthy after ${Math.round(health.waitedMs / 1000)}s (${health.last})`);
  console.log(`✅ Healthy after ${health.attempts} attempt(s), ${Math.round(health.waitedMs / 1000)}s`);

  const raw = opts.config ? fs.readFileSync(opts.config, 'utf8') : await (deps.fetchAppConfig || fetchAppConfig)(app);
  const cfg = buildQaConfig(JSON.parse(raw), { baseUrl });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-layout-'));
  const cfgPath = path.join(tmp, `${opts.app}.layout.qa.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  try {
    const modPath = await (deps.fetchLayoutModule || fetchLayoutModule)();
    const mod = await import(pathToFileURL(modPath).href);
    return await mod.run(cfgPath, { reportOnly });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
