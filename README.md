# 🛡️ AI Platform Sentinel

> Autonomous Post-Deploy Integration Validation, Root Cause Diagnostician & Self-Healing Test Mesh.

`ai-platform-sentinel` automatically validates services after deployment to Render (or local testing), runs canary probes with cold-start tolerance, detects integration breakdowns (CORS, SPA fallback, environment drift, SSE stream drops), and initiates autonomous self-healing.

---

## 🚀 Capabilities

1. **Canary & Render Cold-Start Warmer**:
   - Loops with backoff during Render free-tier sleep spin-ups (502/503 tolerance).
2. **CORS Policy Validator**:
   - Sends synthetic preflight `OPTIONS` requests from `ai-platform-oplox-qa.onrender.com` to verify allowlists.
3. **SPA Deep-Link Verifier**:
   - Verifies client routing (`/nodes`, `/logs`, `/metrics`) returns `index.html` instead of 404.
4. **SSE Handshake Inspector**:
   - Ensures real-time log channels (`/api/logs/stream`) handshake without proxy buffering.
5. **Autonomous Self-Healing**:
   - Injects missing CORS middleware or SPA fallback directly into codebase when enabled (`--heal`).

---

## 💻 CLI Usage

```bash
# Diagnose any service on QA
node bin/sentinel.js test oplox --env qa

# Run with self-healing auto-patcher
node bin/sentinel.js test audio-gym --env qa --heal

# Run local control plane diagnostic doctor
node bin/sentinel.js doctor
```
