/**
 * Writes demo/emi-tracker-demo-backup.json: a completely fictional data set (loans, a chit, bills,
 * a one-time expense, lending & borrowing, a reminder) built with the app's own storage code and
 * saved as a normal backup, so either app can load it with "Restore". Dates are relative to the
 * day it is generated. Run with `npm run demo:data` (never part of the normal test run).
 */
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { buildSnapshot, serialize } from '../../src/main/backup';
import { Db } from '../../src/main/db';
import { Repo } from '../../src/main/repo';
import { addDays, addMonths, fmtISO, parts, type ISODate } from '../../src/shared/dates';
import { computeLoan } from '../../src/shared/engine';
import { blankBill, blankBillPayment, blankDebt, blankDebtRepayment, blankReminder, DEFAULT_PREFERENCES } from '../../src/shared/defaults';
import type { Loan, Payment } from '../../src/shared/types';
import { makeLoan, pay } from '../unit/fixtures';

const out = path.resolve(__dirname, '..', '..', '..', 'demo', 'emi-tracker-demo-backup.json');

it('writes the demo backup', async () => {
  const d = new Date();
  const today = fmtISO(d.getFullYear(), d.getMonth() + 1, d.getDate()) as ISODate;
  const monthsAgo = (n: number, day: number): ISODate => { const [y, m] = parts(addMonths(today, -n)); return fmtISO(y, m, day) as ISODate; };
  const repo = new Repo(await Db.open(null), () => 'demo-device');
  repo.setLocal({ deviceId: 'demo-device', deviceName: 'Demo device' });

  // ---------------------------------------------------------------- loans (all fictional lenders)
  const loan = (over: Partial<Loan>) => repo.saveLoan(makeLoan({ trackingStartDate: over.startDate, ...over }));
  const home = loan({
    id: 'demo-home', name: 'Home loan — Sunrise Bank', loanType: 'home', category: 'Home', lender: 'Sunrise Bank', accountRef: 'HL00012345',
    principal: '4500000.00', sanctionedAmount: '4500000.00', disbursedAmount: '4500000.00', annualRate: '8.6', rateType: 'floating',
    totalInstallments: 240, startDate: monthsAgo(31, 2), firstEmiDate: monthsAgo(30, 5), emiDueDay: 5, processingFee: '5900.00', color: '#5b8def',
  });
  const car = loan({
    id: 'demo-car', name: 'Car loan — Metro Auto Finance', loanType: 'vehicle', category: 'Vehicle', lender: 'Metro Auto Finance', accountRef: 'VL00067890',
    principal: '800000.00', sanctionedAmount: '800000.00', disbursedAmount: '800000.00', annualRate: '9.25', totalInstallments: 60,
    startDate: monthsAgo(15, 8), firstEmiDate: monthsAgo(14, 10), emiDueDay: 10, lateFee: '500.00', color: '#34c38f',
  });
  const personal = loan({
    id: 'demo-personal', name: 'Personal loan — Kaveri Finance', loanType: 'personal', category: 'Personal', lender: 'Kaveri Finance',
    principal: '250000.00', sanctionedAmount: '250000.00', disbursedAmount: '250000.00', annualRate: '12.5', totalInstallments: 36,
    startDate: monthsAgo(9, 12), firstEmiDate: monthsAgo(8, 15), emiDueDay: 15, color: '#f0a63a',
  });
  const chit = loan({
    id: 'demo-chit', name: 'Friends chit — Lakshmi Chits', loanType: 'chit_fund', category: 'Chit fund', lender: 'Lakshmi Chits',
    principal: '100000.00', sanctionedAmount: '100000.00', disbursedAmount: '100000.00', annualRate: '0', interestMethod: 'flat',
    emiAmount: '5000.00', totalInstallments: 20, startDate: monthsAgo(6, 20), firstEmiDate: monthsAgo(6, 20), emiDueDay: 20, color: '#a77bff',
  });

  // ---------------------------------------------------------------- payment history
  const rowsOf = (l: Loan) => computeLoan(l, [], [], today).rows;
  const payments: Payment[] = [];
  const add = (l: Loan, no: number, txnDate: ISODate, amount: string, extra: Partial<Payment> = {}) => payments.push(pay({ id: `demo-p${payments.length + 1}`, loanId: l.id, installmentNo: no, txnDate, amount, ...extra }));
  for (const r of rowsOf(home).filter((x) => x.dueDate < today)) add(home, r.no, addDays(r.dueDate, -1), r.scheduledAmount, { reference: `UPI-${1000 + r.no}` });
  for (const r of rowsOf(car).filter((x) => x.dueDate < today)) add(car, r.no, r.no === 6 ? addDays(r.dueDate, 6) : r.dueDate, r.scheduledAmount); // one EMI paid late
  const pRows = rowsOf(personal).filter((x) => x.dueDate < today);
  for (const r of pRows.slice(0, -1)) add(personal, r.no, r.dueDate, r.scheduledAmount); // the latest one is still unpaid
  const dividends = ['5000.00', '4300.00', '4450.00', '4520.00', '4600.00', '4650.00', '4700.00'];
  for (const r of rowsOf(chit).filter((x) => x.dueDate < today)) add(chit, r.no, r.dueDate, dividends[r.no - 1] ?? '4750.00');
  payments.push(pay({ id: 'demo-prepay', loanId: home.id, type: 'prepayment', txnDate: monthsAgo(7, 18), amount: '100000.00', notes: 'Annual bonus' }));
  for (const p of payments) repo.savePayment(p);

  // ---------------------------------------------------------------- bills and a one-time expense
  const bill = (over: Parameters<typeof blankBill>[0] extends string ? Partial<ReturnType<typeof blankBill>> : never, paidMonths: number, amounts?: string[]) => {
    const b = repo.saveBill({ ...blankBill(today), ...over });
    for (let i = paidMonths; i >= 1; i--) {
      const due = monthsAgo(i, b.dueDay);
      if (due < b.startDate || due >= today) continue;
      repo.saveBillPayment({ ...blankBillPayment(b.id, due, addDays(due, -1), amounts?.[i % amounts.length] ?? b.amount), id: `demo-bp-${b.id}-${i}` });
    }
  };
  bill({ id: 'demo-electricity', name: 'Electricity', category: 'electricity', payee: 'City Power', amount: '1850.00', variable: true, dueDay: 18, startDate: monthsAgo(6, 18) }, 6, ['1720.00', '1980.00', '2140.00', '1850.00']);
  bill({ id: 'demo-mobile', name: 'Mobile plan', category: 'mobile', payee: 'Demo Telecom', amount: '399.00', dueDay: 3, startDate: monthsAgo(6, 3) }, 6);
  bill({ id: 'demo-broadband', name: 'Broadband', category: 'internet', payee: 'FiberNet', amount: '799.00', dueDay: 25, startDate: monthsAgo(6, 25) }, 6);
  bill({ id: 'demo-insurance', name: 'Health insurance premium', category: 'insurance', payee: 'Shield Health Insurance', amount: '6200.00', frequency: 'quarterly', dueDay: 12, startDate: monthsAgo(5, 12) }, 6);
  bill({ id: 'demo-onetime', name: 'Laptop repair', category: 'other', payee: 'Quick Fix Electronics', amount: '3400.00', frequency: 'once', dueDay: 9, startDate: monthsAgo(1, 9) }, 1);

  // ---------------------------------------------------------------- lending & borrowing
  repo.saveDebt({ ...blankDebt(monthsAgo(3, 4), 'lent'), id: 'demo-lent', person: 'Arjun', amount: '15000.00', dueDate: monthsAgo(-1, 4), notes: 'For bike repair' });
  repo.saveDebtRepayment({ ...blankDebtRepayment('demo-lent', monthsAgo(1, 4), '5000.00'), id: 'demo-lent-r1' });
  repo.saveDebt({ ...blankDebt(monthsAgo(2, 22), 'borrowed'), id: 'demo-borrowed', person: 'Meena', amount: '10000.00', dueDate: monthsAgo(-2, 22) });
  repo.saveDebt({ ...blankDebt(monthsAgo(5, 1), 'lent'), id: 'demo-settled', person: 'Kiran', amount: '4000.00', reminderEnabled: false });
  repo.saveDebtRepayment({ ...blankDebtRepayment('demo-settled', monthsAgo(4, 1), '4000.00'), id: 'demo-settled-r1' });

  repo.saveCustomReminder({ ...blankReminder(monthsAgo(-1, 28)), id: 'demo-reminder', title: 'Renew vehicle insurance', description: 'Compare quotes before renewing', loanId: car.id });
  repo.setPreferences({ ...DEFAULT_PREFERENCES });

  const snap = buildSnapshot(repo, 'backup', { name: 'EMI Tracker', version: 'demo', platform: 'desktop' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialize(snap));
  console.warn(`demo backup written: ${out} (${snap.counts.loans} loans, ${snap.counts.payments} payments, ${snap.counts.bills} bills)`);
});
