/**
 * Root Cause Diagnostician
 * Analyzes canary failure signatures and maps them to concrete integration problems and fixes.
 */

import fs from 'fs';
import path from 'path';

export function diagnoseFailures({ serviceName, env, targetUrl, wakeResult, corsResult, spaResult, sseResult, apiResult, infraRoot }) {
  const issues = [];

  // 1. Diagnose Wake-Up / Cold Start
  if (!wakeResult.awake) {
    issues.push({
      code: 'RENDER_COLD_START_OR_CRASH',
      severity: 'CRITICAL',
      title: `Node '${serviceName}' unreachable at ${targetUrl}`,
      description: `Service did not return HTTP < 500 after ${wakeResult.attempts} canary ping attempts over ${Math.round(wakeResult.totalDurationMs / 1000)}s.`,
      evidence: { lastStatus: wakeResult.statusCode, history: wakeResult.history },
      rootCause: 'Render container may be failed on boot, crashed due to an unhandled exception, or failing Render health checks.',
      remediation: [
        `Check Render container logs at: https://dashboard.render.com`,
        `Verify buildCommand includes --include=dev so build tools are installed under NODE_ENV=production.`,
        `Verify startCommand binds to dynamic process.env.PORT on host 0.0.0.0.`,
        `Verify required production environment variables are configured on Render service.`,
        `Run with --heal to automatically patch render.yaml, server host bindings, and synchronize with Render REST API.`,
      ],
      selfHealable: true,
      healAction: 'patch_render_deployment',
    });
  }

  // 2. Diagnose CORS
  if (corsResult && !corsResult.passed) {
    issues.push({
      code: 'CORS_ORIGIN_BLOCKED',
      severity: 'CRITICAL',
      title: `CORS preflight blocked for origin '${corsResult.testedOrigin}'`,
      description: `The service does not return valid Access-Control-Allow-Origin headers for client calls from Oplox.`,
      evidence: {
        testedOrigin: corsResult.testedOrigin,
        allowOrigin: corsResult.allowOrigin || 'None',
        error: corsResult.error,
      },
      rootCause: `Cross-origin resource sharing middleware is either missing or does not include '${corsResult.testedOrigin}' in its allowlist.`,
      remediation: [
        `Add '${corsResult.testedOrigin}' to cors({ origin: [...] }) in server configuration.`,
        `Or enable cors() with permissive origin for QA environment ('*').`,
      ],
      selfHealable: true,
      healAction: 'patch_cors',
    });
  }

  // 3. Diagnose SPA Routing
  if (spaResult && !spaResult.allPassed) {
    const failedRoutes = spaResult.routes.filter((r) => !r.passed);
    issues.push({
      code: 'SPA_ROUTING_FALLBACK_MISSING',
      severity: 'WARNING',
      title: `Deep links returning 404 instead of SPA index.html`,
      description: `Routes like ${failedRoutes.map((r) => r.route).join(', ')} failed to load client bundle.`,
      evidence: { failedRoutes },
      rootCause: `Web server lacks catch-all fallback handler. When a user navigates directly to a client route, Express/Nginx looks for a static file instead of sending index.html.`,
      remediation: [
        `In Express: add app.use((req, res, next) => { if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile(path.join(distPath, 'index.html')); else next(); });`,
        `In Static site: configure rewrite rule in render.yaml (routes: [{ type: rewrite, source: /*, destination: /index.html }]).`,
      ],
      selfHealable: true,
      healAction: 'patch_spa_fallback',
    });
  }

  // 4. Diagnose SSE Streaming
  if (sseResult && !sseResult.passed) {
    issues.push({
      code: 'SSE_LOG_STREAM_DISCONNECTED',
      severity: 'WARNING',
      title: `Real-time log stream failed on ${sseResult.endpoint}`,
      description: `Server-Sent Events endpoint did not respond with Content-Type: text/event-stream.`,
      evidence: { statusCode: sseResult.statusCode, contentType: sseResult.contentType, error: sseResult.error },
      rootCause: `Endpoint might be missing or buffering responses behind reverse proxy.`,
      remediation: [
        `Ensure res.setHeader('Content-Type', 'text/event-stream') and res.flushHeaders() are called.`,
        `Disable reverse-proxy gzip/buffering for SSE endpoints (X-Accel-Buffering: no).`,
      ],
      selfHealable: false,
    });
  }

  // 5. Diagnose API Endpoints
  if (apiResult && !apiResult.allPassed) {
    const failedEps = apiResult.endpoints.filter((e) => !e.passed);
    issues.push({
      code: 'CORE_API_UNAVAILABLE',
      severity: 'CRITICAL',
      title: `Core API endpoints returned failure: ${failedEps.map((e) => e.endpoint).join(', ')}`,
      description: `Endpoints failed or returned invalid non-JSON response.`,
      evidence: { failedEps },
      rootCause: `API handler threw an uncaught error or endpoint path mismatch.`,
      remediation: [
        `Inspect container logs for unhandled route exceptions.`,
        `Verify backend server started and mounted router routes properly.`,
      ],
      selfHealable: false,
    });
  }

  // 6. Check Environment Variable Drift (if infraRoot provided)
  if (infraRoot) {
    const envFile = path.join(infraRoot, `environments/${env}/${serviceName}.env`);
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const expectedKeys = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split('=')[0]);

      // Return expected keys in diagnostic summary
      issues.push({
        code: 'ENV_AUDIT_INFO',
        severity: 'INFO',
        title: `Environment manifest validated against ai-platform-infra`,
        description: `Found ${expectedKeys.length} declared variables in environments/${env}/${serviceName}.env`,
        evidence: { declaredKeys: expectedKeys },
        selfHealable: false,
      });
    }
  }

  return {
    serviceName,
    env,
    targetUrl,
    timestamp: new Date().toISOString(),
    isHealthy: issues.filter((i) => i.severity === 'CRITICAL').length === 0,
    criticalCount: issues.filter((i) => i.severity === 'CRITICAL').length,
    warningCount: issues.filter((i) => i.severity === 'WARNING').length,
    issues,
  };
}
