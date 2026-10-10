/**
 * Remediation & Self-Healing Patcher
 * Automatically resolves common integration bugs (CORS allowlists, SPA catch-alls, .env drift).
 */

import fs from 'fs';
import path from 'path';

export function healCorsIssue(serviceDir) {
  const expressFile = path.join(serviceDir, 'server/index.js');
  if (fs.existsSync(expressFile)) {
    let content = fs.readFileSync(expressFile, 'utf-8');
    if (!content.includes('cors(')) {
      content = `import cors from 'cors';\n` + content;
      content = content.replace(/(const app = express\(\);)/, '$1\napp.use(cors({ origin: true, credentials: true }));');
      fs.writeFileSync(expressFile, content, 'utf-8');
      return { healed: true, file: expressFile, action: 'Added permissive CORS middleware to server/index.js' };
    }
  }

  const fastapiFile = path.join(serviceDir, 'main.py');
  if (fs.existsSync(fastapiFile)) {
    let content = fs.readFileSync(fastapiFile, 'utf-8');
    if (!content.includes('CORSMiddleware')) {
      const corsBlock = `
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
`;
      content = content.replace(/(app = FastAPI\([^\)]*\))/, `$1\n${corsBlock}`);
      fs.writeFileSync(fastapiFile, content, 'utf-8');
      return { healed: true, file: fastapiFile, action: 'Added CORSMiddleware to FastAPI main.py' };
    }
  }

  return { healed: false, reason: 'No supported server entry found to auto-patch.' };
}

export function healSpaRouting(serviceDir) {
  const expressFile = path.join(serviceDir, 'server/index.js');
  if (fs.existsSync(expressFile)) {
    let content = fs.readFileSync(expressFile, 'utf-8');
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
      content = content.replace(/(app\.listen\([^\)]*\);)/, `${spaBlock}\n$1`);
      fs.writeFileSync(expressFile, content, 'utf-8');
      return { healed: true, file: expressFile, action: 'Injected SPA catch-all fallback before app.listen' };
    }
  }
  return { healed: false, reason: 'SPA fallback already present or unsupported server structure.' };
}

export function healEnvDrift(serviceDir, infraRoot, env = 'qa', serviceName) {
  const sourceEnv = path.join(infraRoot, `environments/${env}/${serviceName}.env`);
  const targetEnv = path.join(serviceDir, '.env');

  if (fs.existsSync(sourceEnv)) {
    fs.copyFileSync(sourceEnv, targetEnv);
    return {
      healed: true,
      file: targetEnv,
      action: `Synchronized .env from ai-platform-infra/environments/${env}/${serviceName}.env`,
    };
  }

  return { healed: false, reason: `Source environment template not found in ${sourceEnv}` };
}

export function executeSelfHealing(diagnosis, serviceDir, infraRoot) {
  const results = [];

  for (const issue of diagnosis.issues) {
    if (issue.selfHealable && issue.healAction) {
      if (issue.healAction === 'patch_cors' && serviceDir) {
        results.push(healCorsIssue(serviceDir));
      } else if (issue.healAction === 'patch_spa_fallback' && serviceDir) {
        results.push(healSpaRouting(serviceDir));
      }
    }
  }

  return {
    healedCount: results.filter((r) => r.healed).length,
    results,
  };
}
