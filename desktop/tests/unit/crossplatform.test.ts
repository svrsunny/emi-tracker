/**
 * Cross-platform compatibility between the desktop and Android apps, via files in /fixtures:
 *  - writes a plain + encrypted desktop backup and the expected engine figures, which the
 *    Android core tests (SnapshotTest.readsDesktopBackups) parse and recompute;
 *  - reads the snapshot written by the Android tests (SnapshotTest.writesAndroidSnapshotForDesktop)
 *    and checks checksum, decryption, schema validation and identical engine results.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, parseBackupText, serialize } from '../../src/main/backup';
import { Db } from '../../src/main/db';
import { Repo } from '../../src/main/repo';
import { computeLoan } from '../../src/shared/engine';
import { blankBill, blankBillPayment, blankDebt, blankDebtRepayment, DEFAULT_PREFERENCES } from '../../src/shared/defaults';
import { makeLoan, pay, adj } from './fixtures';

const dir = path.resolve(__dirname, '..', '..', '..', 'fixtures');
const app = { name: 'EMI Tracker', version: 'fixture', platform: 'desktop' as const };

describe('cross-platform fixtures', () => {
  it('writes a desktop backup for the Android app to verify', async () => {
    fs.mkdirSync(dir, { recursive: true });
    const repo = new Repo(await Db.open(null), () => 'desktop-fixture');
    repo.setLocal({ deviceId: 'desktop-fixture', deviceName: 'Fixture PC' });
    repo.saveLoan(makeLoan({ id: 'H1', name: 'Fixture home', principal: '2500000.00', sanctionedAmount: '2500000.00', disbursedAmount: '2500000.00', annualRate: '8.75', totalInstallments: 240, emiAmount: '22093.00', lateFee: '750.00', gracePeriodDays: 3 }));
    repo.saveLoan(makeLoan({ id: 'C1', name: 'Fixture car', principal: '600000.00', sanctionedAmount: '600000.00', disbursedAmount: '600000.00', annualRate: '9.5', totalInstallments: 60, moratoriumPeriods: 2, moratoriumTreatment: 'capitalize', firstEmiDate: '2024-02-10', emiDueDay: 10, notes: 'Quote "test"\nnew line ₹' }));
    const h = computeLoan(repo.loan('H1')!, [], [], '2023-12-31');
    for (const r of h.rows.filter((x) => x.dueDate <= '2024-07-01')) repo.savePayment(pay({ loanId: 'H1', installmentNo: r.no, txnDate: r.no === 3 ? '2024-04-09' : r.dueDate, amount: r.scheduledAmount, reference: `R${r.no}` }));
    repo.savePayment(pay({ loanId: 'H1', type: 'prepayment', txnDate: '2024-05-20', amount: '150000.00' }));
    repo.savePayment(pay({ loanId: 'H1', type: 'fee', txnDate: '2024-04-09', amount: '750.00' }));
    repo.savePayment(pay({ loanId: 'C1', installmentNo: 3, txnDate: '2024-04-10', amount: '5000.00', type: 'partial' }));
    repo.saveAdjustment({ ...adj({ loanId: 'H1', effectiveDate: '2024-06-15', annualRate: '9.00' }), id: 'ADJ1' });
    // a chit fund with dividends (installments paid for less than the full amount)
    repo.saveLoan(makeLoan({ id: 'K1', name: 'Fixture chit', loanType: 'chit_fund', category: 'Chit fund', principal: '100000.00', sanctionedAmount: '100000.00', disbursedAmount: '100000.00',
      annualRate: '0', rateType: 'fixed', interestMethod: 'flat', emiAmount: '5000.00', totalInstallments: 20, startDate: '2024-03-05', firstEmiDate: '2024-03-05', emiDueDay: 5, trackingStartDate: '2024-03-05' }));
    for (const [no, amount] of [[1, '5000.00'], [2, '4600.00'], [3, '4400.00'], [4, '4750.00']] as const) repo.savePayment(pay({ loanId: 'K1', installmentNo: no, txnDate: `2024-0${no + 2}-05`, amount }));
    // a one-time expense (paid), lending & borrowing with a part repayment, a deleted entry and a sent lending reminder
    const ts = '2024-08-01T00:00:00.000Z';
    repo.saveBill({ ...blankBill('2024-07-20'), id: 'O1', name: 'Fixture car service', category: 'other', amount: '4500.00', frequency: 'once' });
    repo.saveBillPayment({ ...blankBillPayment('O1', '2024-07-20', '2024-07-20', '4300.00'), id: 'OP1' });
    repo.saveDebt({ ...blankDebt('2024-06-01', 'lent'), id: 'DL1', person: 'Fixture friend', amount: '10000.00', dueDate: '2024-09-01', notes: 'cash' });
    repo.saveDebtRepayment({ ...blankDebtRepayment('DL1', '2024-07-01', '4000.00'), id: 'DR1' });
    repo.saveDebt({ ...blankDebt('2024-05-01', 'borrowed'), id: 'DB1', person: 'Fixture uncle', amount: '25000.00' });
    repo.saveDebt({ ...blankDebt('2024-05-01', 'lent'), id: 'DX1', person: 'Deleted', amount: '100.00' });
    repo.deleteDebt('DX1');
    repo.saveNotification({ id: 'N1', createdAt: ts, updatedAt: ts, key: 'debt_due:DL1:2024-09-01', category: 'debt', title: 'Collect', body: 'b', loanId: null,
      scheduledFor: '2024-09-01T09:00', deliveredAt: ts, state: 'sent', snoozedUntil: null, channel: 'in_app', late: false, deviceId: 'desktop-fixture' });
    repo.setPreferences({ ...DEFAULT_PREFERENCES, heatmapPalette: 'violet' });
    const snap = buildSnapshot(repo, 'backup', app);
    fs.writeFileSync(path.join(dir, 'desktop-backup.json'), serialize(snap));
    fs.writeFileSync(path.join(dir, 'desktop-backup-encrypted.emibackup'), serialize(snap, 'fixture-passphrase'));
    const asOf = '2024-08-15';
    const loans: Record<string, Record<string, string>> = {};
    for (const l of repo.loans()) {
      const s = computeLoan(l, repo.adjustments(), repo.payments(), asOf).summary;
      loans[l.id] = { outstandingPrincipal: s.outstandingPrincipal, totalPaid: s.totalPaid, interestPaid: s.interestPaid, remainingInterest: s.remainingInterest, closureDate: s.closureDate ?? '', installmentsPaid: String(s.installmentsPaid), dividends: s.dividends };
    }
    fs.writeFileSync(path.join(dir, 'desktop-expected.json'), JSON.stringify({ asOf, loans }, null, 1));
    expect(parseBackupText(fs.readFileSync(path.join(dir, 'desktop-backup.json'), 'utf8')).checksum).toBe(snap.checksum);
  });

  it('reads the snapshot written by the Android app', () => {
    const file = path.join(dir, 'android-snapshot.json');
    if (!fs.existsSync(file)) return; // produced by `gradlew :core:test`
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'android-expected.json'), 'utf8'));
    const snap = parseBackupText(fs.readFileSync(file, 'utf8'));
    expect(snap.checksum).toBe(expected.checksum);
    expect(snap.app.platform).toBe('android');
    const enc = parseBackupText(fs.readFileSync(path.join(dir, 'android-snapshot-encrypted.emisync'), 'utf8'), 'fixture-passphrase');
    expect(enc.checksum).toBe(expected.checksum);
    const loan = snap.data.loans.find((l) => l.id === expected.loanId)!;
    const s = computeLoan(loan, snap.data.adjustments, snap.data.payments, expected.asOf).summary;
    expect(s.outstandingPrincipal).toBe(expected.outstandingPrincipal);
    expect(s.remainingInterest).toBe(expected.remainingInterest);
    expect(s.closureDate ?? 'null').toBe(expected.closureDate);
    expect(snap.data.customReminders[0].title).toBe('Check "statement"\n');
    // what the Android app writes for one-time expenses and lending & borrowing passes the desktop checks
    expect(snap.data.bills.find((b) => b.id === 'AO1')?.frequency).toBe('once');
    expect(snap.data.debts.map((d) => [d.id, d.direction])).toEqual([['AB1', 'borrowed'], ['AL1', 'lent']]);
    expect(snap.data.debtRepayments.map((r) => r.amount)).toEqual(['2500.00']);
    expect(snap.data.tombstones.some((t) => t.table === 'debts')).toBe(true);
    expect(snap.data.notifications.some((n) => n.category === 'debt')).toBe(true);
  });
});
