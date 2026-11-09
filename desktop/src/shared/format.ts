import { parts, type ISODate } from './dates';
import type { Preferences } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function makeFormatters(p: Pick<Preferences, 'currency' | 'locale' | 'decimals' | 'dateFormat'>) {
  const cur = new Intl.NumberFormat(p.locale, { style: 'currency', currency: p.currency, minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals });
  const curCompact = new Intl.NumberFormat(p.locale, { style: 'currency', currency: p.currency, notation: 'compact', maximumFractionDigits: 1 });
  const num = new Intl.NumberFormat(p.locale, { maximumFractionDigits: 2 });
  const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : cur.format(Number(v)));
  const compact = (v: string | number) => {
    const n = Number(v);
    // Indian short form: lakh / crore
    if (p.locale === 'en-IN' && p.currency === 'INR') {
      const a = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
      if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
      if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}K`;
      return `${sign}₹${a.toFixed(0)}`;
    }
    return curCompact.format(n);
  };
  const date = (d: ISODate | null | undefined) => {
    if (!d) return '—';
    const [y, m, day] = parts(d);
    const dd = String(day).padStart(2, '0'), mm = String(m).padStart(2, '0');
    switch (p.dateFormat) {
      case 'DD/MM/YYYY': return `${dd}/${mm}/${y}`;
      case 'MM/DD/YYYY': return `${mm}/${dd}/${y}`;
      case 'YYYY-MM-DD': return d;
      default: return `${dd} ${MONTHS[m - 1]} ${y}`;
    }
  };
  const month = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  };
  return { money, compact, date, month, number: (v: number) => num.format(v), pct: (v: number) => `${v.toFixed(1)}%` };
}

export type Formatters = ReturnType<typeof makeFormatters>;

export function maskRef(ref: string, mask: boolean): string {
  if (!mask || ref.length <= 4) return ref;
  return '•••• ' + ref.slice(-4);
}

export const MONTH_NAMES = MONTHS;
