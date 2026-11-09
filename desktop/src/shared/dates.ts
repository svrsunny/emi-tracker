/**
 * Pure calendar-date helpers on ISO "YYYY-MM-DD" strings. No time zones are involved:
 * every financial date is a civil date. ISO strings compare correctly with < and >.
 */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parts(iso: ISODate): [number, number, number] {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  return [+m[1], +m[2], +m[3]];
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function fmtISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 (proleptic Gregorian), Howard Hinnant's algorithm. */
export function toDays(iso: ISODate): number {
  const [y0, m, d] = parts(iso);
  const y = y0 - (m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDays(z: number): ISODate {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return fmtISO(y + (m <= 2 ? 1 : 0), m, d);
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromDays(toDays(iso) + n);
}

export function diffDays(from: ISODate, to: ISODate): number {
  return toDays(to) - toDays(from);
}

/**
 * Add calendar months, clamping the day to the month's length. `day` overrides the day of
 * month (e.g. EMI due day 31 -> 30 Apr, 28/29 Feb).
 */
export function addMonths(iso: ISODate, n: number, day?: number): ISODate {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const want = day ?? d;
  return fmtISO(ny, nm, Math.min(want, daysInMonth(ny, nm)));
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(iso: ISODate): number {
  return (((toDays(iso) + 4) % 7) + 7) % 7;
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function startOfMonth(iso: ISODate): ISODate {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso: ISODate): ISODate {
  const [y, m] = parts(iso);
  return fmtISO(y, m, daysInMonth(y, m));
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Local civil date of a JS Date (uses the host time zone or an explicit IANA zone). */
export function todayISO(now: Date = new Date(), timeZone?: string): ISODate {
  if (timeZone) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(now);
  }
  return fmtISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** ISO week key "YYYY-Www" (ISO-8601 weeks). */
export function isoWeekKey(iso: ISODate): string {
  const days = toDays(iso);
  const wd = (weekday(iso) + 6) % 7; // Monday = 0
  const thursday = fromDays(days - wd + 3);
  const [ty] = parts(thursday);
  const jan1 = toDays(fmtISO(ty, 1, 1));
  const week = Math.floor((toDays(thursday) - jan1) / 7) + 1;
  return `${ty}-W${String(week).padStart(2, '0')}`;
}
