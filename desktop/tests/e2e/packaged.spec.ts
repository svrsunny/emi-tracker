/**
 * Smoke test of the packaged Windows build (release/win-unpacked) — run after `npm run dist`.
 * Verifies the installed app starts, stores data in its local SQLite file, survives a restart,
 * and makes no network requests. Skipped when the packaged build is absent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const exe = path.resolve(__dirname, '..', '..', 'release', 'win-unpacked', 'EMI Tracker.exe');

test.skip(!fs.existsSync(exe), 'packaged build not present (run npm run dist)');

test('packaged app stores data locally and persists across restarts', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emi-packaged-'));
  const external: string[] = [];
  const launch = async () => {
    const app = await electron.launch({ executablePath: exe, env: { ...process.env, EMI_TRACKER_DATA_DIR: dataDir } });
    const page = await app.firstWindow();
    page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url())) external.push(r.url()); });
    return { app, page };
  };

  let { app, page } = await launch();
  await expect(page.getByText('Track every loan, privately')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Explore with demo data' }).click();
  await expect(page.getByText('Demo loans added')).toBeVisible();
  await expect(page.getByRole('button', { name: /Demo Home Loan/ }).first()).toBeVisible();
  await page.screenshot({ path: path.resolve(__dirname, '..', '..', 'test-results', 'screens', '10-packaged-dashboard.png') });
  const blocked = await page.evaluate(async () => ((await window.emi.invoke('diagnostics:get')) as { ok: true; value: { blockedRequests: number; integrity: { ok: boolean } } }).value);
  expect(blocked.blockedRequests).toBe(0);
  expect(blocked.integrity.ok).toBe(true);
  await app.close();

  const db = path.join(dataDir, 'emi-tracker.sqlite');
  expect(fs.existsSync(db)).toBe(true);
  expect(fs.statSync(db).size).toBeGreaterThan(10_000);

  ({ app, page } = await launch());
  await expect(page.getByRole('button', { name: /Demo Home Loan/ }).first()).toBeVisible({ timeout: 30_000 });
  await app.close();
  expect(external).toEqual([]);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
