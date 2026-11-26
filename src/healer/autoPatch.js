/**
 * Remediation Patcher (propose-only)
 * Works out fixes for common integration bugs and writes them as a patch for
 * review. It never edits the target, calls Render to change anything, or deploys.
 */

import fs from 'fs';
import { createWorkspace, writeProposal } from './workspace.js';

const SERVER_FILE = 'server/index.js';

export function assertHealingAllowed(env) {
  if (String(env ?? '').trim().toLowerCase() === 'prod') {
    const error = new Error(
      'Sentinel healing is disabled for prod. Run probes only: sentinel test <service> --env prod',
    );
    error.code = 'SENTINEL_HEAL_PROD';
    throw error;
  }
}

export function healSpaRouting(serviceDir, workspace = createWorkspace(serviceDir)) {
  if (workspace.exists(SERVER_FILE)) {
    const content = workspace.read(SERVER_FILE);
    if (!content.includes("res.sendFile(path.join(distPath, 'index.html'))")) {
      const spaBlock = `
// [Sentinel Auto-Patch] SPA Fallback
const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
`;
      const patched = content.replace(/^app\.listen\(/m, (listen) => `${spaBlock}\n${listen}`);
      if (patched !== content) {
        workspace.write(SERVER_FILE, patched);
        return { healed: true, file: SERVER_FILE, action: 'Add SPA catch-all fallback before app.listen' };
      }
    }
  }
  return { healed: false, reason: 'SPA fallback already present or unsupported server structure.' };
}

function proposeRenderYaml(workspace, actions) {
  const file = 'render.yaml';
  if (!workspace.exists(file)) return;
  let content = workspace.read(file);

  if (content.includes('buildCommand: npm install && npm run build')) {
    content = content.replaceAll(
      'buildCommand: npm install && npm run build',
      'buildCommand: npm install --include=dev && npm run build',
    );
    actions.push('Set render.yaml buildCommand to: npm install --include=dev && npm run build');
  }

  if (!content.includes('NODE_VERSION')) {
    const withVersion = content.replace(
      /(envVars:\s*\n(\s*-\s*key:[^\n]+\n\s*value:[^\n]+\n)*)/g,
      (match) => `${match}      - key: NODE_VERSION\n        value: 20\n`,
    );
    if (withVersion !== content) {
      content = withVersion;
      actions.push('Add NODE_VERSION: 20 to render.yaml');
    }
  }

  workspace.write(file, content);
}

function proposePackageJson(workspace, actions) {
  const file = 'package.json';
  if (!workspace.exists(file)) return;
  const original = workspace.read(file);
  let pkg;
  try {
    pkg = JSON.parse(original);
  } catch (error) {
    console.warn(`   Skipping package.json: it is not valid JSON (${error.message})`);
    return;
  }
  const found = [];

  if (!pkg.engines?.node) {
    pkg.engines = { ...pkg.engines, node: '>=20.0.0' };
    found.push('Add engines.node >=20.0.0 to package.json');
  }

  const buildTools = ['vite', 'vue-tsc', 'typescript', 'tailwindcss', 'daisyui', '@vitejs/plugin-vue', 'postcss', 'autoprefixer'];
  const toMove = buildTools.filter((dep) => pkg.devDependencies?.[dep]);
  if (toMove.length) {
    pkg.dependencies = pkg.dependencies || {};
    for (const dep of toMove) {
      pkg.dependencies[dep] = pkg.devDependencies[dep];
      delete pkg.devDependencies[dep];
    }
    found.push('Move build tools to production dependencies in package.json');
  }

  if (found.length) {
    const newline = original.endsWith('\n') ? '\n' : '';
    workspace.write(file, `${JSON.stringify(pkg, null, 2)}${newline}`);
    actions.push(...found);
  }
}

function proposeServerFile(workspace, actions) {
  if (!workspace.exists(SERVER_FILE)) return;
  let content = workspace.read(SERVER_FILE);

  if (content.includes('app.listen(PORT, () =>')) {
    content = content.replace('app.listen(PORT, () =>', "app.listen(PORT, '0.0.0.0', () =>");
    actions.push(`Bind the listener to 0.0.0.0 in ${SERVER_FILE}`);
  }

  if (!content.includes('/health')) {
    const healthSnippet = `
// [Sentinel Auto-Patch] Health check endpoints for Render
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
`;
    const withHealth = content.replace(/^app\.use\(.*\);/m, (use) => `${use}\n${healthSnippet}`);
    if (withHealth !== content) {
      content = withHealth;
      actions.push(`Add /health and /api/health endpoints to ${SERVER_FILE}`);
    }
  }

  workspace.write(SERVER_FILE, content);
}

export async function healRenderDeployment(serviceDir, serviceName, env = 'qa', workspace = createWorkspace(serviceDir)) {
  assertHealingAllowed(env);
  if (!serviceDir || !fs.existsSync(serviceDir)) {
    return { healed: false, reason: `Service directory not found: ${serviceDir}` };
  }

  const actions = [];
  proposeRenderYaml(workspace, actions);
  proposePackageJson(workspace, actions);
  proposeServerFile(workspace, actions);

  return { healed: actions.length > 0, actions };
}

export async function executeSelfHealing(diagnosis, serviceDir, context = {}) {
  const { serviceName = diagnosis.serviceName, env = diagnosis.env, proposalsRoot } = context;
  assertHealingAllowed(env);
  assertHealingAllowed(diagnosis.env);

  const results = [];
  if (!serviceDir || !fs.existsSync(serviceDir)) {
    return { healedCount: 0, results, proposal: null };
  }

  const workspace = createWorkspace(serviceDir);
  for (const issue of diagnosis.issues) {
    if (!issue.selfHealable) continue;
    if (issue.healAction === 'patch_spa_fallback') {
      results.push(healSpaRouting(serviceDir, workspace));
    } else if (issue.healAction === 'patch_render_deployment') {
      results.push(await healRenderDeployment(serviceDir, serviceName, env, workspace));
    }
  }

  const changes = workspace.changes();
  const actions = results.filter((r) => r.healed).flatMap((r) => r.actions ?? [r.action]);
  const proposal = changes.length
    ? writeProposal({ serviceDir, serviceName, env, changes, actions, issues: diagnosis.issues, proposalsRoot })
    : null;

  return {
    healedCount: results.filter((r) => r.healed).length,
    results,
    proposal,
  };
}
