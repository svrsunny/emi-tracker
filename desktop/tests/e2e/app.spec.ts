/**
 * End-to-end: drives the real Electron app (built output) against a throw-away data folder.
 * Covers creating a loan, recording a payment, the dashboard, heatmaps, reminders,
 * backup + restore, and verifies that no external network request is ever made.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FakePhone } from './fakePhone';

const root = path.resolve(__dirname, '..', '..');
const shots = path.join(root, 'test-results', 'screens');
let app: ElectronApplication;
let page: Page;
let dataDir: string;
const external: string[] = [];

test.beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emi-e2e-'));
  fs.mkdirSync(shots, { recursive: true });
  app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, EMI_TRACKER_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url())) external.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector('text=Track every loan, privately');
});

test.afterAll(async () => {
  await app?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const shot = (name: string) => page.screenshot({ path: path.join(shots, `${name}.png`) });

test('create a loan with the wizard', async () => {
  await page.getByRole('button', { name: 'Add your first loan' }).click();
  await page.getByLabel('Loan name').fill('E2E Home Loan');
  await page.getByLabel('Lender / bank').fill('Test Bank');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Original principal').fill('1000000');
  await page.getByLabel('Annual interest rate').fill('10');
  await page.getByRole('button', { name: 'Enter from lender' }).click();
  await page.getByLabel('EMI per installment').fill('13215.07');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Loan start / disbursement date').fill('2024-01-01');
  await page.getByLabel('First EMI date').fill('2024-02-01');
  await page.getByLabel('Total EMI installments').fill('120');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // history step: track from the first EMI so past rows are real overdue items
  await page.getByLabel('Tracking start date').fill('2024-01-01');
  await page.getByRole('button', { name: 'Continue' }).click();
  // reminders step: asked whether to remind, which days, and the due dates
  await expect(page.getByText("Do you want reminders for this loan's EMIs?")).toBeVisible();
  await page.getByRole('radio', { name: 'Yes, remind me' }).click();
  await page.getByLabel('10 days before').check();
  await expect(page.getByText('Your next reminders')).toBeVisible();
  await shot('01a-wizard-reminders');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Calculated preview')).toBeVisible();
  await expect(page.getByText(/10, 7, 3, 1 day\(s\) before/)).toBeVisible();
  await shot('01-wizard-review');
  await page.getByRole('button', { name: 'Create loan' }).click();
  await expect(page.getByText('Loan created')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible();
  await shot('02-dashboard');
});

test('record a payment and see it reflected', async () => {
  await page.getByRole('button', { name: 'Payment Tracker' }).click();
  await page.getByRole('button', { name: 'Mark paid…' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Transaction date').fill('2024-02-01');
  await page.getByLabel('Reference (optional)').fill('UTR-E2E-1');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'UTR-E2E-1' })).toBeVisible();
  // duplicate prevention: the same EMI again triggers a confirmation
  await page.getByRole('button', { name: 'Record payment' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Installment', { exact: true }).selectOption({ index: 1 });
  await dlg.getByLabel('Type', { exact: true }).selectOption('emi');
  await dlg.getByLabel('Transaction date').fill('2024-02-01');
  await dlg.getByLabel('Amount', { exact: true }).fill('13215.07');
  await dlg.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Possible duplicate')).toBeVisible();
  await shot('03-payments');
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('loan detail shows schedule and totals', async () => {
  await page.getByRole('button', { name: 'All Loans' }).click();
  await page.getByText('E2E Home Loan').first().click();
  await expect(page.getByText('Outstanding principal').first()).toBeVisible();
  await expect(page.getByText('Installments paid').or(page.getByText('Paid', { exact: true })).first()).toBeVisible();
  await page.getByRole('tab', { name: /Amortization/ }).click();
  await expect(page.getByRole('cell', { name: '120' }).first()).toBeVisible();
  await shot('04-schedule');
});

test('heatmap renders and a cell opens details', async () => {
  await page.getByRole('button', { name: 'Repayment Heatmaps' }).click();
  await page.locator('select[aria-label="Period"]').selectOption('2024');
  const cell = page.locator('[data-date="2024-02-01"]');
  await cell.click();
  await expect(page.getByText('Total paid').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await expect(page.getByRole('grid', { name: 'Monthly repayment heatmap' })).toBeVisible();
  await page.getByRole('radio', { name: 'Scheduled vs actual' }).click();
  await shot('05-heatmap');
});

test('add a standalone reminder without a loan', async () => {
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Add reminder' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Title').fill('Pay house rent');
  await dlg.getByLabel('Note (shown in the notification)').fill('Transfer to landlord');
  await dlg.getByLabel('Repeat').selectOption('monthly');
  await expect(dlg.getByLabel('Linked loan (optional)')).toHaveValue('');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Reminder saved')).toBeVisible();
  await page.getByRole('button', { name: 'Reminders' }).click();
  await page.getByRole('tab', { name: /My reminders/ }).click();
  await expect(page.getByRole('cell', { name: /Pay house rent/ })).toBeVisible();
  const saved = await page.evaluate(async () => (await window.emi.invoke('data:load')) as { ok: true; value: { customReminders: { title: string; loanId: string | null }[] } });
  expect(saved.value.customReminders.find((r) => r.title === 'Pay house rent')?.loanId).toBeNull();
  await shot('05a-my-reminders');
});

test('PDF reports are clean documents', async () => {
  const out = path.join(root, 'test-results', 'pdf');
  fs.mkdirSync(out, { recursive: true });
  await page.getByRole('button', { name: 'Reports & Analytics' }).click();
  for (const [report, file] of [['Loan summary', 'loan-summary.pdf'], ['Amortization schedule', 'schedule.pdf'], ['Payment history', 'payments.pdf']] as const) {
    await page.getByRole('button', { name: new RegExp(`^${report}`) }).click();
    await app.evaluate(async ({ dialog }, f) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog; }, path.join(out, file));
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(page.getByText('PDF saved').last()).toBeVisible();
    await expect.poll(() => fs.existsSync(path.join(out, file))).toBe(true);
    const pdf = fs.readFileSync(path.join(out, file));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
  }
});

test('configure reminders and send a test notification', async () => {
  await page.getByRole('button', { name: 'Reminders' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Notification time').fill('08:30');
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.getByText('Reminder settings saved')).toBeVisible();
  await page.getByRole('tab', { name: 'Diagnostics' }).click();
  await page.getByRole('button', { name: 'Send test notification' }).click();
  await expect(page.getByText('Test notification sent')).toBeVisible();
  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByText('EMI Tracker test notification').first()).toBeVisible();
  await shot('06-reminders');
});

test('backup and restore round-trip', async () => {
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  await app.evaluate(async ({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
  }, backupDir);
  await page.getByRole('button', { name: 'Backup, Sync & Restore' }).click();
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backup created and verified')).toBeVisible();
  const file = fs.readdirSync(backupDir).find((f) => f.endsWith('.json'))!;
  expect(file).toBeTruthy();
  const snap = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
  expect(snap.counts.loans).toBe(1);

  // change data after the backup, then restore and confirm the change is gone
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add demo loans' }).click();
  await expect(page.getByText('Demo loans added')).toBeVisible();

  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
  }, path.join(backupDir, file));
  await page.getByRole('button', { name: 'Backup, Sync & Restore' }).click();
  await page.getByRole('button', { name: 'Choose backup to restore…' }).click();
  await expect(page.getByText('Backup is valid')).toBeVisible();
  await page.getByRole('button', { name: 'Restore this backup…' }).click();
  await page.getByLabel(/Type RESTORE to confirm/).fill('RESTORE');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Restore complete')).toBeVisible();
  await shot('07-restore');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'All Loans' }).click();
  await page.getByRole('radio', { name: 'All' }).click();
  await expect(page.getByText('E2E Home Loan')).toBeVisible();
  await expect(page.getByText('Demo Home Loan')).toHaveCount(0);
});

test('light theme and remaining pages render', async () => {
  for (const name of ['Calendar', 'Amortization', 'Forecasts & What-if', 'Reports & Analytics', 'Help & Diagnostics']) {
    await page.getByRole('button', { name }).click();
    await expect(page.locator('.page-title')).toBeVisible();
  }
  await shot('08-help');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: /Light/ }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await shot('09-dashboard-light');
});

test('add a chit fund without any interest and record a dividend', async () => {
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Add loan' }).click();
  await page.getByLabel('Loan type').selectOption('chit_fund');
  await page.getByLabel('Loan name').fill('Ramesh chit');
  await page.getByLabel('Foreman / organiser').fill('Ramesh');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Annual interest rate')).toHaveCount(0); // no interest asked
  await page.getByLabel('Chit value').fill('100000');
  await page.getByLabel('Monthly installment').fill('5000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('First installment date').fill('2026-10-05');
  await expect(page.getByLabel('Number of months')).toHaveValue('20');
  await shot('12-chit-schedule');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continue' }).click(); // to charges, history, reminders
  await expect(page.getByText("Do you want reminders for this chit's installments?")).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Calculated preview')).toBeVisible();
  await expect(page.getByText('Total interest (contract)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create loan' }).click();
  await expect(page.getByText('Loan created')).toBeVisible();

  await page.getByRole('button', { name: 'All Loans' }).click();
  await page.getByText('Ramesh chit').first().click();
  await page.getByRole('tab', { name: /Amortization/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Dividend' })).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Amount you paid')).toBeVisible();
  await dlg.getByLabel('Amount you paid').fill('4600');
  await dlg.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByText('Dividends received')).toBeVisible();
  await expect(page.getByText('₹400.00').first()).toBeVisible();
  await shot('13-chit-detail');
  const loaded = await page.evaluate(async () => (await window.emi.invoke('data:load')) as { ok: true; value: { loans: { name: string; loanType: string; annualRate: string; emiAmount: string; totalInstallments: number }[] } });
  const c = loaded.value.loans.find((l) => l.name === 'Ramesh chit')!;
  expect([c.loanType, c.annualRate, c.emiAmount, c.totalInstallments]).toEqual(['chit_fund', '0', '5000.00', 20]);
});

test('bills: add one, mark it paid, and see it in monthly expenses', async () => {
  await page.getByRole('button', { name: 'Bills', exact: true }).click();
  await page.getByRole('button', { name: 'Add your first bill' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Bill name').fill('Electricity');
  await dlg.getByLabel('Amount', { exact: true }).fill('1800');
  await dlg.getByLabel('The amount changes every time (electricity, water…)').check();
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await dlg.getByLabel('First due date').fill(iso);
  await expect(dlg.getByText('Remind me about this bill?')).toBeVisible();
  await dlg.getByRole('button', { name: 'Add bill' }).click();
  await expect(page.getByText('Bill added')).toBeVisible();
  await expect(page.getByRole('cell', { name: /^Electricity/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mark paid' }).first().click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Amount paid').fill('2140');
  await pay.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('Electricity marked paid')).toBeVisible();
  await shot('14-bills');

  await page.getByRole('button', { name: 'Monthly Expenses' }).click();
  await expect(page.getByRole('heading', { name: 'Monthly expenses' })).toBeVisible();
  const row = page.getByRole('row', { name: /Electricity/ });
  await expect(row).toContainText('₹2,140.00');
  await expect(row).toContainText('Paid');
  await expect(page.getByText('Where the money goes')).toBeVisible();
  await shot('15-expenses');
  const saved = await page.evaluate(async () => (await window.emi.invoke('data:load')) as { ok: true; value: { bills: { name: string }[]; billPayments: { amount: string }[] } });
  expect(saved.value.bills.map((b) => b.name)).toContain('Electricity');
  expect(saved.value.billPayments.map((b) => b.amount)).toContain('2140.00');

  // the calendar shows the bill on its due day and what was spent that day
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  const panel = page.locator('.card').filter({ hasText: 'Spent on this day' });
  await expect(panel).toContainText('Electricity');
  await expect(panel).toContainText('Bills');
  await expect(panel).toContainText('₹2,140.00');
  await expect(page.locator('.cal-day.today')).toContainText('Spent');
  await shot('15b-calendar');
});

test('one-time expense: recorded as paid and counted in monthly expenses', async () => {
  await page.getByRole('button', { name: 'Bills', exact: true }).click();
  await page.getByRole('button', { name: 'One-time expense' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('What for').fill('Car service');
  await dlg.getByLabel('Amount', { exact: true }).fill('4500');
  await expect(dlg.getByLabel('Due day of month')).toHaveCount(0);
  await expect(dlg.getByLabel('Already paid')).toBeChecked();
  await dlg.getByRole('button', { name: 'Add bill' }).click();
  await expect(page.getByText('Expense added as paid')).toBeVisible();
  await expect(page.getByText('One-time expenses').first()).toBeVisible();
  await page.getByRole('button', { name: 'Monthly Expenses' }).click();
  const row = page.getByRole('row', { name: /Car service/ });
  await expect(row).toContainText('one-time');
  await expect(row).toContainText('Paid');
});

test('lending & borrowing: lend, get part back, borrow, and see what is pending', async () => {
  await page.getByRole('button', { name: 'Lending & Borrowing' }).click();
  await page.getByRole('button', { name: 'I lent', exact: true }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel('Lent to').fill('Ravi');
  await dlg.getByLabel('Amount', { exact: true }).fill('10000');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Lending added')).toBeVisible();
  await page.getByRole('button', { name: 'Got money back' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Amount', { exact: true }).fill('12000');
  await dlg.getByRole('button', { name: 'Record' }).click();
  await expect(dlg.getByText('Only ₹10,000.00 is pending')).toBeVisible();
  await dlg.getByLabel('Amount', { exact: true }).fill('4000');
  await dlg.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Recorded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I borrowed' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Borrowed from').fill('Uncle');
  await dlg.getByLabel('Amount', { exact: true }).fill('25000');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Borrowing added')).toBeVisible();
  await expect(page.locator('.stat-value').filter({ hasText: '₹6,000.00' })).toBeVisible();
  await expect(page.locator('.stat-value').filter({ hasText: '₹25,000.00' })).toBeVisible();
  await shot('17-lending');
  // the cards follow the filter: settle Ravi, then the Settled view totals what was closed
  await page.getByRole('radio', { name: 'Lent', exact: true }).click();
  await expect(page.getByText('Got back so far')).toBeVisible();
  await page.getByRole('button', { name: 'Got money back' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Settled with Ravi')).toBeVisible();
  await page.getByRole('radio', { name: 'Settled', exact: true }).click();
  await expect(page.locator('.card').filter({ hasText: 'Total settled' })).toContainText('₹10,000.00');
  await expect(page.locator('.card').filter({ hasText: 'Lent and got back in full' })).toContainText('₹10,000.00');
  // lending is not an expense
  await page.getByRole('button', { name: 'Monthly Expenses' }).click();
  await expect(page.getByRole('row', { name: /Ravi|Uncle/ })).toHaveCount(0);
});

test('app lock: set a PIN, lock, refuse a wrong PIN, unlock', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Lock with', { exact: true }).selectOption('pin');
  await page.getByLabel('PIN', { exact: true }).fill('4826');
  await page.getByLabel('Repeat it').fill('4826');
  await page.getByRole('button', { name: 'Save app lock' }).click();
  await expect(page.getByText('App lock saved')).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('dialog', { name: 'EMI Tracker is locked' })).toBeVisible();
  // while locked, the main process refuses data requests
  const refused = await page.evaluate(async () => window.emi.invoke('data:load'));
  expect(refused).toMatchObject({ ok: false, code: 'locked' });
  await shot('16-locked');
  await page.getByLabel('PIN').fill('1111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong PIN')).toBeVisible();
  await page.getByLabel('PIN').fill('4826');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // switching to a password asks for the current PIN, never Windows Hello
  await page.getByLabel('Lock with', { exact: true }).selectOption('password');
  await page.getByLabel('Password', { exact: true }).fill('mango-tree');
  await page.getByLabel('Repeat it').fill('mango-tree');
  await page.getByRole('button', { name: 'Save app lock' }).click();
  await expect(page.getByText('Enter your current PIN to change the lock')).toBeVisible();
  await page.getByLabel('Current PIN').fill('4826');
  await page.getByRole('button', { name: 'Save app lock' }).click();
  await expect(page.getByText('App lock saved')).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByText('Enter your password to continue')).toBeVisible();
  await page.getByLabel('Password').fill('mango-tree');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // turn it off again (needs the current password)
  await page.getByLabel('Lock with', { exact: true }).selectOption('none');
  await page.getByLabel('Current password').fill('mango-tree');
  await page.getByRole('button', { name: 'Save app lock' }).click();
  await expect(page.getByText('App lock turned off')).toBeVisible();
});

test('Wi-Fi sync: pair a phone with the code and exchange data', async () => {
  // a test port, so a real EMI Tracker already syncing on this PC (default port 47830) is never touched
  await page.evaluate(() => window.emi.invoke('local:set', { lanPort: 47931 }));
  await page.getByRole('button', { name: 'Backup, Sync & Restore' }).click();
  await page.getByText('Allow my paired phone to sync over Wi-Fi').click();
  await expect(page.getByText('Wi-Fi sync is on')).toBeVisible();
  await page.getByRole('button', { name: 'Pair a phone' }).click();
  const code = (await page.getByLabel('Pairing code').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await shot('10-wifi-pairing');
  const base = 'http://127.0.0.1:47931/emi-sync';
  expect(await (await fetch(`${base}/hello`)).json()).toEqual({ app: 'emi-tracker', protocol: 1, syncRequested: false });

  const phone = new FakePhone('e2e-phone-0001');
  // a wrong code is refused
  expect((await phone.pair(base, code === '000000' ? '111111' : '000000')).status).toBe(401);
  expect((await phone.pair(base, code)).status).toBe(200);
  await expect(page.getByRole('cell', { name: /^E2E Phone Paired/ })).toBeVisible();

  // the phone sends a snapshot holding loans the PC does not have and gets the merged PC data back
  const phoneSnap = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'fixtures', 'android-snapshot.json'), 'utf8'));
  phoneSnap.kind = 'sync';
  phoneSnap.deviceId = phone.deviceId;
  const res = await phone.sync(base, JSON.stringify(phoneSnap));
  expect(res.status, JSON.stringify(res).slice(0, 300)).toBe(200);
  expect(res.snapshot!.kind).toBe('sync');
  const pcLoanNames = res.snapshot!.data.loans.map((l) => l.name);
  expect(pcLoanNames).toContain('E2E Home Loan');
  for (const l of phoneSnap.data.loans as { name: string }[]) expect(pcLoanNames).toContain(l.name);
  // "Sync now" on the PC dashboard: the phone sees the request on /hello, syncs, and the PC confirms
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('button', { name: 'Waiting for phone…' })).toBeVisible();
  expect(await (await fetch(`${base}/hello`)).json()).toMatchObject({ syncRequested: true });
  expect((await phone.sync(base, JSON.stringify(phoneSnap))).status).toBe(200);
  await expect(page.getByText(/^Synced with /).first()).toBeVisible(); // named after the phone's own device name
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  expect(await (await fetch(`${base}/hello`)).json()).toMatchObject({ syncRequested: false });
  await shot('12-sync-now');
  // a device the PC never paired, or a wrong key, is rejected
  const stranger = new FakePhone('e2e-phone-0002');
  stranger.key = crypto.randomBytes(32);
  expect((await stranger.sync(base, JSON.stringify(phoneSnap))).status).toBe(401);
  phone.key = crypto.randomBytes(32);
  expect((await phone.sync(base, JSON.stringify(phoneSnap))).status).toBe(401);
  await shot('11-wifi-paired');
  await page.getByRole('button', { name: 'All Loans' }).click();
  await expect(page.getByText(phoneSnap.data.loans[0].name).first()).toBeVisible();
});

test('no external network requests were made', async () => {
  expect(external).toEqual([]);
  const blocked = await page.evaluate(async () => {
    const r = await window.emi.invoke('diagnostics:get');
    return (r as { ok: true; value: { blockedRequests: number } }).value.blockedRequests;
  });
  expect(blocked).toBe(0);
});
