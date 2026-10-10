/**
 * Canary Health & Integration Prober
 * Validates availability, cold-start wakeups, CORS policies, SPA routing, and SSE streams.
 */

export async function wakeUpNode(targetUrl, { maxAttempts = 6, intervalMs = 6000, timeoutMs = 8000 } = {}) {
  const history = [];
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();
    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Oplox-Sentinel-Canary/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - attemptStart;
      history.push({ attempt, statusCode: res.status, latencyMs, timestamp: new Date().toLocaleTimeString() });

      // If response is good or client error (not gateway error)
      if (res.status < 500) {
        return {
          awake: true,
          statusCode: res.status,
          attempts: attempt,
          totalDurationMs: Date.now() - startTime,
          latencyMs,
          history,
        };
      }

      // 502/503/504 is typical Render sleep or reverse-proxy gateway warm-up
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    } catch (err) {
      history.push({
        attempt,
        statusCode: 0,
        error: err.message,
        latencyMs: Date.now() - attemptStart,
        timestamp: new Date().toLocaleTimeString(),
      });
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  return {
    awake: false,
    statusCode: history[history.length - 1]?.statusCode || 0,
    attempts: maxAttempts,
    totalDurationMs: Date.now() - startTime,
    history,
    error: 'Node did not wake up within canary timeout limit.',
  };
}

export async function probeCors(targetUrl, clientOrigin = 'https://ai-platform-oplox-qa.onrender.com') {
  try {
    const probeUrl = targetUrl.includes('/api') ? targetUrl : `${targetUrl.replace(/\/$/, '')}/api/apps`;
    const preflight = await fetch(probeUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: clientOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
      signal: AbortSignal.timeout(4000),
    });

    const allowOrigin = preflight.headers.get('access-control-allow-origin');
    const allowMethods = preflight.headers.get('access-control-allow-methods');

    const isWildcard = allowOrigin === '*';
    const isSpecific = allowOrigin === clientOrigin;
    const isPermitted = isWildcard || isSpecific;

    return {
      passed: Boolean(isPermitted),
      preflightStatus: preflight.status,
      allowOrigin,
      allowMethods,
      testedOrigin: clientOrigin,
    };
  } catch (err) {
    return {
      passed: false,
      error: err.message,
      testedOrigin: clientOrigin,
    };
  }
}

export async function probeSpaRouting(baseUrl, routes = ['/nodes', '/logs', '/metrics']) {
  const results = [];

  for (const route of routes) {
    const fullUrl = new URL(route, baseUrl).toString();
    try {
      const res = await fetch(fullUrl, {
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(5000),
      });

      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      const isHtml = contentType.includes('text/html') || text.includes('<!DOCTYPE html>') || text.includes('<html');

      const passed = res.status === 200 && isHtml;
      results.push({
        route,
        fullUrl,
        statusCode: res.status,
        isHtml,
        passed,
      });
    } catch (err) {
      results.push({
        route,
        fullUrl,
        statusCode: 0,
        passed: false,
        error: err.message,
      });
    }
  }

  return {
    allPassed: results.every((r) => r.passed),
    routes: results,
  };
}

export async function probeSseStream(baseUrl, endpoint = '/api/logs/stream') {
  const fullUrl = new URL(endpoint, baseUrl).toString();
  try {
    const res = await fetch(fullUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(4000),
    });

    const contentType = res.headers.get('content-type') || '';
    const isEventStream = contentType.includes('text/event-stream');

    return {
      passed: res.status === 200 && isEventStream,
      statusCode: res.status,
      contentType,
      endpoint,
    };
  } catch (err) {
    return {
      passed: false,
      endpoint,
      error: err.message,
    };
  }
}

export async function probeApiEndpoints(baseUrl, endpoints = ['/api/apps', '/api/logs']) {
  const results = [];

  for (const ep of endpoints) {
    const fullUrl = new URL(ep, baseUrl).toString();
    try {
      const res = await fetch(fullUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      let json = null;
      let isJson = false;
      try {
        json = await res.json();
        isJson = true;
      } catch (e) {}

      results.push({
        endpoint: ep,
        statusCode: res.status,
        isJson,
        passed: res.status === 200 && isJson,
        sampleCount: Array.isArray(json) ? json.length : null,
      });
    } catch (err) {
      results.push({
        endpoint: ep,
        statusCode: 0,
        passed: false,
        error: err.message,
      });
    }
  }

  return {
    allPassed: results.every((r) => r.passed),
    endpoints: results,
  };
}
