/**
 * Remediation & Self-Healing Patcher
 * Automatically resolves common integration bugs (CORS allowlists, SPA catch-alls, .env drift).
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export function healCorsIssue(serviceDir) {
  const expressFile = path.join(serviceDir, 'server/index.js');
  if (fs.existsSync(expressFile)) {
    let content = fs.readFileSync(expressFile, 'utf-8');
    if (!content.includes('cors(')) {
      content = `import cors from 'cors';\n` + content;
      content = content.replace(/(const app = express\(\);)/, '$1\napp.use(cors({ origin: true, credentials: true }));');
      fs.writeFileSync(expressFile, content, 'utf-8');
      return { healed: true, file: expressFile, action: 'Added permissive CORS middleware to server/index.js' };
    } else if (content.includes('app.use(cors());')) {
      content = content.replace('app.use(cors());', 'app.use(cors({ origin: true, credentials: true }));');
      fs.writeFileSync(expressFile, content, 'utf-8');
      return { healed: true, file: expressFile, action: 'Upgraded CORS middleware to allow dynamic origins and credentials' };
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

export async function healRenderDeployment(serviceDir, serviceName, env = 'qa') {
  const actions = [];
  if (!serviceDir || !fs.existsSync(serviceDir)) {
    return { healed: false, reason: `Service directory not found: ${serviceDir}` };
  }

  // 1. Patch render.yaml
  const renderYamlPath = path.join(serviceDir, 'render.yaml');
  if (fs.existsSync(renderYamlPath)) {
    let content = fs.readFileSync(renderYamlPath, 'utf-8');
    let modified = false;

    if (content.includes('buildCommand: npm install && npm run build')) {
      content = content.replaceAll(
        'buildCommand: npm install && npm run build',
        'buildCommand: npm install --include=dev && npm run build'
      );
      modified = true;
      actions.push('Updated render.yaml buildCommand to: npm install --include=dev && npm run build');
    }

    if (!content.includes('NODE_VERSION')) {
      content = content.replace(/(envVars:\s*\n(\s*-\s*key:[^\n]+\n\s*value:[^\n]+\n)*)/g, (match) => {
        return match + '      - key: NODE_VERSION\n        value: 20\n';
      });
      modified = true;
      actions.push('Injected NODE_VERSION: 20 into render.yaml');
    }

    if (modified) {
      fs.writeFileSync(renderYamlPath, content, 'utf-8');
    }
  }

  // 2. Patch package.json
  const pkgPath = path.join(serviceDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      let modified = false;

      if (!pkg.engines || !pkg.engines.node) {
        pkg.engines = { ...pkg.engines, node: '>=20.0.0' };
        modified = true;
        actions.push('Added engines.node >=20.0.0 to package.json');
      }

      const criticalDeps = [
        'vite',
        'vue-tsc',
        'typescript',
        'tailwindcss',
        'daisyui',
        '@vitejs/plugin-vue',
        'postcss',
        'autoprefixer',
      ];
      pkg.dependencies = pkg.dependencies || {};
      pkg.devDependencies = pkg.devDependencies || {};

      for (const dep of criticalDeps) {
        if (pkg.devDependencies[dep]) {
          pkg.dependencies[dep] = pkg.devDependencies[dep];
          delete pkg.devDependencies[dep];
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
        actions.push('Elevated build tools to production dependencies in package.json');
      }
    } catch (e) {}
  }

  // 3. Patch server/index.js
  const expressFile = path.join(serviceDir, 'server/index.js');
  if (fs.existsSync(expressFile)) {
    let content = fs.readFileSync(expressFile, 'utf-8');
    let modified = false;

    if (content.includes('app.listen(PORT, () =>')) {
      content = content.replace('app.listen(PORT, () =>', "app.listen(PORT, '0.0.0.0', () =>");
      modified = true;
      actions.push('Bound daemon listener explicitly to 0.0.0.0 in server/index.js');
    }

    if (!content.includes('/health')) {
      const healthSnippet = `
// [Sentinel Auto-Patch] Health check endpoints for Render
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
`;
      content = content.replace(/(app\.use\([^\)]*\);)/, `$1\n${healthSnippet}`);
      modified = true;
      actions.push('Injected /health and /api/health endpoints into server/index.js');
    }

    if (modified) {
      fs.writeFileSync(expressFile, content, 'utf-8');
    }
  }

  // 4. Remote Render API sync
  let renderApiKey = process.env.RENDER_API_KEY;
  if (!renderApiKey && process.platform === 'win32') {
    try {
      renderApiKey = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'RENDER_API_KEY\', \'User\')"', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (e) {}
  }
  if (renderApiKey) {
    try {
      const candidates = [
        serviceName,
        `${serviceName}-${env}`,
        `ai-platform-${serviceName}-${env}`,
        `ai-app-${serviceName}-${env}`,
      ];

      const listRes = await fetch('https://api.render.com/v1/services?limit=50', {
        headers: { Authorization: `Bearer ${renderApiKey}`, Accept: 'application/json' },
      });

      if (listRes.ok) {
        const services = await listRes.json();
        const match = services.find((s) => {
          const name = s.service?.name?.toLowerCase();
          const slug = s.service?.slug?.toLowerCase();
          return candidates.some((c) => name === c.toLowerCase() || slug === c.toLowerCase());
        });

        if (match && match.service?.id) {
          const srvId = match.service.id;
          await fetch(`https://api.render.com/v1/services/${srvId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${renderApiKey}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              serviceDetails: {
                envSpecificDetails: {
                  buildCommand: 'npm install --include=dev && npm run build',
                  startCommand: 'npm run server',
                },
              },
            }),
          });
          actions.push(`Synchronized service '${match.service.name}' buildCommand via Render REST API`);

          await fetch(`https://api.render.com/v1/services/${srvId}/deploys`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${renderApiKey}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ clearCache: 'clear' }),
          });
          actions.push(`Triggered fresh cloud deploy with cache clear for Render service ${srvId}`);
        }
      }
    } catch (e) {
      actions.push(`Render API sync skipped: ${e.message}`);
    }
  }

  return {
    healed: actions.length > 0,
    actions,
  };
}

export async function executeSelfHealing(diagnosis, serviceDir, infraRoot, context = {}) {
  const results = [];
  const { serviceName, env } = context;

  for (const issue of diagnosis.issues) {
    if (issue.selfHealable && issue.healAction) {
      if (issue.healAction === 'patch_cors' && serviceDir) {
        results.push(healCorsIssue(serviceDir));
      } else if (issue.healAction === 'patch_spa_fallback' && serviceDir) {
        results.push(healSpaRouting(serviceDir));
      } else if (issue.healAction === 'patch_render_deployment' && serviceDir) {
        const renderRes = await healRenderDeployment(serviceDir, serviceName, env);
        results.push(renderRes);
      }
    }
  }

  return {
    healedCount: results.filter((r) => r.healed).length,
    results,
  };
}
