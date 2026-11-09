/**
 * Decimal-safe money arithmetic.
 *
 * Rounding policy (documented in docs/FINANCIAL_CALCULATIONS.md):
 *  - All money values are stored as decimal strings with 2 fraction digits ("12345.67").
 *  - Intermediate calculations run at 40 significant digits.
 *  - Every posted money component (interest of a period, penalty, allocation) is rounded
 *    to 2 decimals with ROUND_HALF_UP at the moment it is posted.
 *  - EMI rounding is configurable per loan (paisa / nearest rupee / rupee up).
 */
import Decimal from 'decimal.js';

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO: Dec = new D(0);
/** Amounts at or below this are treated as settled (half a paisa). */
export const EPS: Dec = new D('0.005');

export function dec(v: string | number | Dec | null | undefined): Dec {
  if (v === null || v === undefined || v === '') return ZERO;
  return new D(v as Decimal.Value);
}

export function round2(v: Dec): Dec {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Serialize to the canonical 2-decimal money string. */
export function money(v: Dec | string | number): string {
  return round2(dec(v)).toFixed(2);
}

export function isMoneyString(s: string): boolean {
  return /^-?\d{1,13}(\.\d{1,2})?$/.test(s);
}

export function minD(a: Dec, b: Dec): Dec {
  return a.lessThan(b) ? a : b;
}
export function maxD(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}
export function sumD(values: Iterable<Dec>): Dec {
  let s = ZERO;
  for (const v of values) s = s.plus(v);
  return s;
}

export type EmiRounding = 'paisa' | 'rupee_nearest' | 'rupee_up';

export function roundEmi(v: Dec, mode: EmiRounding): Dec {
  switch (mode) {
    case 'paisa':
      return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    case 'rupee_nearest':
      return v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    case 'rupee_up':
      return v.toDecimalPlaces(0, Decimal.ROUND_CEIL);
  }
}

/**
 * Standard reducing-balance EMI: P * r * (1+r)^n / ((1+r)^n - 1), r = periodic rate.
 * r = 0 degenerates to P / n.
 */
export function emiFormula(principal: Dec, periodicRate: Dec, n: number): Dec {
  if (n <= 0) return principal;
  if (periodicRate.isZero()) return principal.div(n);
  const f = periodicRate.plus(1).pow(n);
  return principal.mul(periodicRate).mul(f).div(f.minus(1));
}
