// Manual test helper: launches the built desktop app on a throw-away data folder, turns on
// Wi-Fi sync, opens pairing and prints the code, then keeps running until killed.
// Usage: node scripts/lan-demo.mjs <dataDir>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.argv[2];
if (!dataDir) throw new Error('usage: node scripts/lan-demo.mjs <dataDir>');
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, EMI_TRACKER_DATA_DIR: dataDir } });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Backup, Sync & Restore' }).waitFor();
// start with the demo loans so the phone has something to receive
if (await page.getByRole('button', { name: 'Explore with demo data' }).isVisible()) {
  await page.getByRole('button', { name: 'Explore with demo data' }).click();
  await page.getByText('Demo loans added').waitFor();
}
// own port: never clash with a real EMI Tracker syncing on this PC
await page.evaluate((lanPort) => window.emi.invoke('local:set', { lanPort }), Number(process.env.LAN_PORT ?? 47931));
await page.getByRole('button', { name: 'Backup, Sync & Restore' }).click();
const on = await page.evaluate(async () => (await window.emi.invoke('lan:status')).value.enabled);
if (!on) await page.getByText('Allow my paired phone to sync over Wi-Fi').click();
await page.getByRole('button', { name: 'Pair a phone' }).click();
const code = (await page.getByLabel('Pairing code').textContent()).trim();
console.log(`PAIRING_CODE=${code}`);
await page.screenshot({ path: path.join(dataDir, 'pc-pairing.png') });
process.stdin.resume();
const shot = async () => { try { await page.screenshot({ path: path.join(dataDir, 'pc-now.png') }); } catch { /* window closed */ } };
setInterval(shot, 3000);
