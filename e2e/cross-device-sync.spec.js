import { test, expect } from '@playwright/test';

const OPLOX_QA_URL = process.env.OPLOX_QA_URL || 'https://ai-platform-oplox-qa.onrender.com';
const BADMINTON_QA_URL = process.env.BADMINTON_QA_URL || 'https://ai-app-shuttle-feed-qa.onrender.com';
const AUDIO_QA_URL = process.env.AUDIO_QA_URL || 'https://off-grid-audio-qa.onrender.com';

test.describe('Sentinel Multi-Context Cross-Device Synchronization Battery', () => {
  const ts = Date.now();
  const USER = {
    name: `PW CrossDevice ${ts}`,
    email: `pw.cross.${ts}@oplox.dev`,
    password: `PlaywrightSync2026!${ts}`,
  };

  const CUSTOM_SHOTS = [
    { id: `shot_pw_1_${ts}`, name: 'PW Drop Shot 01', direction: 20, height: 5, speed: 12, frequency: 2.0, lift: 1 },
    { id: `shot_pw_2_${ts}`, name: 'PW Smash 02', direction: 45, height: 8, speed: 28, frequency: 2.0, lift: 2 },
  ];

  const CUSTOM_DRILL = {
    id: `drill_pw_${ts}`,
    name: 'PW 2-Corner Blitz Routine',
    rounds: 6,
    shotIds: [`shot_pw_1_${ts}`, `shot_pw_2_${ts}`],
  };

  test('Seamless cross-device fleet sync & Court Commander routine hydration', async ({ browser }) => {
    // =========================================================================
    // 📱 DEVICE 1: MOBILE CLIENT (Clean incognito-style isolated context)
    // =========================================================================
    const device1 = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone viewport
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Sentinel/1.0',
    });
    const page1 = await device1.newPage();

    // 1. Register User on Device 1 via API/UI
    const regRes = await page1.request.post(`${OPLOX_QA_URL}/api/auth/register`, {
      data: {
        name: USER.name,
        email: USER.email,
        password: USER.password,
        role: 'Member',
      },
    });
    expect(regRes.status()).toBe(201);
    const regData = await regRes.json();
    const token1 = regData.token;
    const userId = regData.user.id;

    // 2. Device 1 provisions Court Commander and Off-Grid Audio
    const prov1 = await page1.request.post(`${OPLOX_QA_URL}/api/auth/provision`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { appId: 'court-commander' },
    });
    expect(prov1.status()).toBe(200);

    const prov2 = await page1.request.post(`${OPLOX_QA_URL}/api/auth/provision`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { appId: 'off-grid-audio' },
    });
    expect(prov2.status()).toBe(200);

    // 3. Mint launch token for Court Commander
    const exchangeRes1 = await page1.request.post(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      headers: { Authorization: `Bearer ${token1}` },
      data: { targetAppId: 'court-commander' },
    });
    expect(exchangeRes1.status()).toBe(200);
    const { launchToken: badmintonToken1 } = await exchangeRes1.json();

    // 4. Navigate Device 1 to live Court Commander QA with signed token
    await page1.goto(`${BADMINTON_QA_URL}?token=${encodeURIComponent(badmintonToken1)}`);
    await page1.waitForLoadState('domcontentloaded');

    // 5. Device 1 saves custom shots & routine drill into local storage & triggers cloud sync
    const userCleanKey = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    await page1.evaluate(
      ({ userCleanKey, CUSTOM_SHOTS, CUSTOM_DRILL, badmintonToken1, OPLOX_QA_URL }) => {
        // Write to local storage
        localStorage.setItem(`siboasi_saved_shots_v2_${userCleanKey}`, JSON.stringify(CUSTOM_SHOTS));
        localStorage.setItem(`siboasi_drill_catalog_v2_${userCleanKey}`, JSON.stringify([CUSTOM_DRILL]));

        // Synchronize to multi-tenant cloud partition
        return fetch(`${OPLOX_QA_URL}/api/apps/user-data/court-commander`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${badmintonToken1}`,
          },
          body: JSON.stringify({
            data: {
              savedShots: CUSTOM_SHOTS,
              drillCatalog: [CUSTOM_DRILL],
            },
          }),
        }).then((r) => r.json());
      },
      { userCleanKey, CUSTOM_SHOTS, CUSTOM_DRILL, badmintonToken1, OPLOX_QA_URL }
    );

    // Confirm Device 1 local storage holds the routines
    const dev1Shots = await page1.evaluate(
      ({ userCleanKey }) => localStorage.getItem(`siboasi_saved_shots_v2_${userCleanKey}`),
      { userCleanKey }
    );
    expect(JSON.parse(dev1Shots).length).toBe(2);

    // Close Device 1 completely
    await device1.close();

    // =========================================================================
    // 💻 DEVICE 2: BRAND NEW DESKTOP CLIENT (Zero shared storage/cookies)
    // =========================================================================
    const device2 = await browser.newContext({
      viewport: { width: 1440, height: 900 }, // Desktop viewport
    });
    const page2 = await device2.newPage();

    // 1. Confirm Device 2 starts with zero user cached routines on origin
    await page2.goto(OPLOX_QA_URL);
    await page2.waitForLoadState('domcontentloaded');
    const initialShots = await page2.evaluate(
      ({ userCleanKey }) => localStorage.getItem(`siboasi_saved_shots_v2_${userCleanKey}`),
      { userCleanKey }
    );
    expect(initialShots).toBeNull();

    // 2. User logs in on Device 2 via Oplox QA password login
    const loginRes = await page2.request.post(`${OPLOX_QA_URL}/api/auth/login`, {
      data: {
        identifier: USER.email,
        password: USER.password,
      },
    });
    expect(loginRes.status()).toBe(200);
    const loginData = await loginRes.json();
    const token2 = loginData.token;

    // Verify Device 2 fleet was restored from cloud profile
    expect(loginData.user.allowedAppIds).toContain('court-commander');
    expect(loginData.user.allowedAppIds).toContain('off-grid-audio');

    // 3. Device 2 exchanges signed launch token for Court Commander
    const exchangeRes2 = await page2.request.post(`${OPLOX_QA_URL}/api/auth/token/exchange`, {
      headers: { Authorization: `Bearer ${token2}` },
      data: { targetAppId: 'court-commander' },
    });
    expect(exchangeRes2.status()).toBe(200);
    const { launchToken: badmintonToken2 } = await exchangeRes2.json();

    // 4. Device 2 opens Court Commander QA
    await page2.goto(`${BADMINTON_QA_URL}?token=${encodeURIComponent(badmintonToken2)}`);
    await page2.waitForLoadState('domcontentloaded');

    // 5. Verify Device 2 automatically hydrated the custom shots & drills from cloud!
    await expect.poll(async () => {
      return await page2.evaluate(({ userCleanKey }) => {
        const raw = localStorage.getItem(`siboasi_saved_shots_v2_${userCleanKey}`);
        if (!raw) return 0;
        try { return JSON.parse(raw).length; } catch { return 0; }
      }, { userCleanKey });
    }, { timeout: 15000, intervals: [500, 1000] }).toBe(2);

    await expect.poll(async () => {
      return await page2.evaluate(({ userCleanKey }) => {
        const raw = localStorage.getItem(`siboasi_drill_catalog_v2_${userCleanKey}`);
        if (!raw) return 0;
        try { return JSON.parse(raw).length; } catch { return 0; }
      }, { userCleanKey });
    }, { timeout: 15000, intervals: [500, 1000] }).toBe(1);

    // Verify the hydrated shot and drill contents match Device 1
    const dev2HydratedShots = await page2.evaluate(
      ({ userCleanKey }) => JSON.parse(localStorage.getItem(`siboasi_saved_shots_v2_${userCleanKey}`)),
      { userCleanKey }
    );
    expect(dev2HydratedShots[0].name).toBe('PW Drop Shot 01');
    expect(dev2HydratedShots[1].name).toBe('PW Smash 02');

    const dev2HydratedDrills = await page2.evaluate(
      ({ userCleanKey }) => JSON.parse(localStorage.getItem(`siboasi_drill_catalog_v2_${userCleanKey}`)),
      { userCleanKey }
    );
    expect(dev2HydratedDrills[0].name).toBe('PW 2-Corner Blitz Routine');

    await device2.close();
  });
});
