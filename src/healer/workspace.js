/**
 * Propose-only workspace.
 * Patchers read the target through it and stage new content in memory. Nothing
 * here writes inside the target: the result is a patch file kept elsewhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

export function createWorkspace(serviceDir) {
  const staged = new Map();
  const original = (file) => fs.readFileSync(path.join(serviceDir, file), 'utf-8');

  return {
    serviceDir,
    exists: (file) => fs.existsSync(path.join(serviceDir, file)),
    read: (file) => (staged.has(file) ? staged.get(file) : original(file)),
    write: (file, content) => staged.set(file, content),
    changes: () =>
      [...staged]
        .map(([file, after]) => {
          const before = original(file);
          // Keep a CRLF file CRLF, including the lines a patcher added.
          return { file, before, after: before.includes('\r\n') ? after.replace(/\r?\n/g, '\r\n') : after };
        })
        .filter((change) => change.before !== change.after),
  };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Resolves links on the part of the path that already exists.
function realPath(target) {
  let existing = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) {
    missing.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(fs.realpathSync.native(existing), ...missing);
}

function unifiedDiff(changes) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-diff-'));
  try {
    for (const { file, before, after } of changes) {
      for (const [side, content] of [['a', before], ['b', after]]) {
        const full = path.join(scratch, side, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
      }
    }
    const diff = spawnSync(
      'git',
      ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-textconv', '--no-prefix', 'a', 'b'],
      { cwd: scratch, encoding: 'utf-8' },
    );
    // git diff --no-index exits 1 when the two sides differ.
    if (diff.status !== 1) {
      throw new Error(`Could not generate the patch: ${diff.error?.message || diff.stderr || `git exited ${diff.status}`}`);
    }
    return diff.stdout;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function writeProposal({ serviceDir, serviceName = 'service', env = 'qa', changes, actions, issues = [], proposalsRoot }) {
  const root =
    proposalsRoot || process.env.SENTINEL_PROPOSALS_DIR || path.join(os.homedir(), '.sentinel', 'proposals');
  if (isInside(realPath(serviceDir), realPath(root))) {
    throw new Error(`The proposals folder must be outside the service directory: ${root}`);
  }

  const patch = unifiedDiff(changes);
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, '-');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, `${safe(serviceName)}-${safe(env)}-${stamp}-`));
  const patchPath = path.join(dir, 'patch.diff');
  const planPath = path.join(dir, 'plan.md');
  const files = changes.map((change) => change.file);

  const plan = [
    `# Proposed fix: ${serviceName} (${env})`,
    '',
    'Sentinel has not changed, committed, pushed or deployed anything. Review the patch, then apply it yourself.',
    '',
    '## Issues',
    ...issues.map((issue) => `- ${issue.code}: ${issue.title}`),
    '',
    '## Proposed changes',
    ...actions.map((action) => `- ${action}`),
    '',
    '## Apply',
    `From \`${path.resolve(serviceDir)}\`:`,
    '',
    '```',
    `git apply --check "${patchPath}"`,
    `git apply "${patchPath}"`,
    '```',
    '',
    "Then run the service's tests and build, and open a pull request.",
    '',
  ].join('\n');

  fs.writeFileSync(patchPath, patch, 'utf-8');
  fs.writeFileSync(planPath, plan, 'utf-8');
  return { dir, patchPath, planPath, files, actions };
}
