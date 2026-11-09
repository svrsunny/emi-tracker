/**
 * Captures the README screenshots from the real Windows app: a throw-away data folder, the fictional
 * demo backup (demo/emi-tracker-demo-backup.json) restored into it, then one PNG per screen into
 * assets/screenshots/windows/. Local file paths and this PC's network address are masked by Playwright.
 * Run: `npm run build` then `npx playwright test --config playwright.screens.config.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { FakePhone } from '../e2e/fakePhone';

const root = path.resolve(__dirname, '..', '..');
const demo = path.resolve(root, '..', 'demo', 'emi-tracker-demo-backup.json');
const outDir = path.resolve(root, '..', 'assets', 'screenshots', 'windows');
let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emi-shots-'));
  fs.mkdirSync(outDir, { recursive: true });
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, EMI_TRACKER_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('text=Track every loan, privately');
  const r = await page.evaluate((file) => window.emi.invoke('backup:restore', { path: file }), demo);
  expect(r).toMatchObject({ ok: true });
  // a fixed theme, and a test port so a real EMI Tracker on this PC (port 47830) is never touched
  await page.evaluate(() => window.emi.invoke('local:set', { lanPort: 47931 }));
  await page.reload();
  await page.waitForSelector('text=Dashboard');
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// menu buttons may carry a count badge, e.g. "Payment Tracker 1"
const nav = (name: string) => page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\d+)?$`) }).first().click();
const shot = async (name: string, mask: Locator[] = []) => {
  await page.waitForTimeout(600); // charts finish animating
  // close pop-up notifications (reminders, "no backup yet") so they do not cover the screen
  for (let i = 0; i < 20 && (await page.locator('.toast').count()) > 0; i++) await page.locator('.toast button[aria-label="Dismiss"]').first().click();
  await page.screenshot({ path: path.join(outDir, `${name}.png`), mask, maskColor: '#1b2333' });
};

test('capture', async () => {
  await nav('Dashboard');
  await expect(page.getByText('Outstanding principal').first()).toBeVisible();
  await shot('dashboard');

  await nav('All Loans');
  await shot('loan-list');

  await page.getByText('Home loan — Sunrise Bank').locator('visible=true').first().click();
  await expect(page.getByRole('heading', { name: 'Home loan — Sunrise Bank' })).toBeVisible();
  await shot('loan-details');

  await nav('Payment Tracker');
  await shot('payment-history');

  await nav('Monthly Expenses');
  await shot('monthly-expenses');

  await nav('Calendar');
  await page.locator('.cal-day:not(.other)').filter({ hasText: 'Spent' }).first().click(); // a day with payments
  await shot('calendar');

  await nav('Bills');
  await shot('bills');

  await nav('Lending & Borrowing');
  await shot('lending-borrowing');

  await nav('All Loans');
  await page.getByRole('button', { name: 'Add loan' }).first().click();
  await page.getByLabel('Loan name').fill('Education loan — Northstar Bank');
  await page.getByLabel('Lender / bank').fill('Northstar Bank');
  await shot('add-loan');
  await page.keyboard.press('Escape');

  // Wi-Fi sync with a paired (simulated) phone; the PC's own address and folder paths are masked
  await nav('Backup, Sync & Restore');
  await page.getByText('Allow my paired phone to sync over Wi-Fi').click();
  await page.getByRole('button', { name: 'Pair a phone' }).click();
  const code = (await page.getByLabel('Pairing code').textContent())!.trim();
  expect((await new FakePhone('demo-phone-0001', 'Demo phone (Android)').pair('http://127.0.0.1:47931/emi-sync', code)).status).toBe(200);
  await expect(page.getByRole('cell', { name: /^Demo phone/ })).toBeVisible();
  const card = page.locator('.card').filter({ hasText: 'Wi-Fi sync with your phone' }).first();
  await card.scrollIntoViewIfNeeded();
  await shot('wifi-sync', [page.locator('.mono'), page.getByText(/[A-Za-z]:\\/)]);
});
