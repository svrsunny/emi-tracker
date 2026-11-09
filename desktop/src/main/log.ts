/**
 * Minimal diagnostic log. Messages are event descriptions only — callers must never pass
 * amounts, names, account references or passphrases. Kept in memory for the diagnostics
 * screen and mirrored to stdout in development.
 */
const MAX = 300;
const entries: { at: string; area: string; message: string }[] = [];

export function log(area: string, message: string): void {
  entries.push({ at: new Date().toISOString(), area, message });
  if (entries.length > MAX) entries.shift();
  if (process.env.VITE_DEV_SERVER_URL) console.log(`[${area}] ${message}`);
}

export function recentLog() {
  return [...entries].reverse();
}
