import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { csvObjects } from '../../shared/csv';
import { blankLoan, blankPayment } from '../../shared/defaults';
import { isValidISODate, parts } from '../../shared/dates';
import { calculateEmi } from '../../shared/engine';
import { loanSchema, paymentSchema, firstError } from '../../shared/validation';
import type { Loan, Payment, PaymentType } from '../../shared/types';
import { call } from '../lib/api';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { Callout, Modal } from './ui';

/**
 * Spreadsheet import (CSV). Two layouts are accepted:
 *  - Loans:    name, lender, principal, annual_rate, tenure_months|installments, start_date, first_emi_date[, emi, category, notes]
 *  - Payments: loan, date, amount[, type, installment, reference, notes]
 * Full-fidelity JSON backups are restored from the Backup page.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { data, asOf, reload, toast } = useStore();
  const { go } = useRouter();
  const [preview, setPreview] = useState<{ name: string; loans: Loan[]; payments: Payment[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const f = await call<{ name: string; text: string } | null>('import:openText');
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.json')) {
      toast({ kind: 'info', title: 'JSON backups are restored from Backup & Restore', body: 'Opening that page…' });
      go('/backup');
      onClose();
      return;
    }
    const rows = csvObjects(f.text);
    const errors: string[] = [];
    const loans: Loan[] = [];
    const payments: Payment[] = [];
    const num = (s: string | undefined) => (s ?? '').replace(/[₹,\s]/g, '');
    const date = (s: string | undefined) => {
      const v = (s ?? '').trim();
      if (isValidISODate(v)) return v;
      const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v); // DD/MM/YYYY
      if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; if (isValidISODate(iso)) return iso; }
      return '';
    };
    const isPayments = rows.length > 0 && ('amount' in rows[0]) && ('loan' in rows[0] || 'loan_name' in rows[0]);
    rows.forEach((r, i) => {
      const line = i + 2;
      if (isPayments) {
        const name = r.loan || r.loan_name;
        const loan = [...data.loans, ...loans].find((l) => l.name.toLowerCase() === name?.toLowerCase());
        if (!loan) { errors.push(`Row ${line}: no loan named “${name}”`); return; }
        const type = (r.type || 'emi').toLowerCase() as PaymentType;
        const p: Payment = { ...blankPayment(loan.id, asOf), txnDate: date(r.date || r.txn_date), amount: (+num(r.amount)).toFixed(2), type,
          installmentNo: r.installment ? parseInt(r.installment, 10) : null, reference: r.reference ?? '', notes: r.notes ?? '' };
        const v = paymentSchema.safeParse(p);
        if (!v.success) errors.push(`Row ${line}: ${firstError(v.error)}`); else payments.push(p);
      } else {
        const l: Loan = { ...blankLoan(asOf, data.loans.length + loans.length) };
        l.name = r.name || r.loan_name || `Imported loan ${i + 1}`;
        l.lender = r.lender || r.bank || '';
        l.category = r.category || 'Imported';
        l.principal = (+num(r.principal || r.amount)).toFixed(2);
        l.sanctionedAmount = l.principal; l.disbursedAmount = l.principal;
        l.annualRate = num(r.annual_rate || r.rate || r.interest_rate);
        l.totalInstallments = parseInt(r.installments || r.tenure_months || r.tenure || '0', 10);
        l.startDate = date(r.start_date || r.disbursement_date);
        l.firstEmiDate = date(r.first_emi_date || r.first_emi);
        if (l.firstEmiDate) l.emiDueDay = parts(l.firstEmiDate)[2];
        l.trackingStartDate = asOf;
        l.emiAmount = r.emi ? (+num(r.emi)).toFixed(2) : null;
        l.notes = r.notes ?? '';
        const v = loanSchema.safeParse(l);
        if (!v.success) errors.push(`Row ${line}: ${firstError(v.error)}`);
        else {
          if (!l.emiAmount) l.emiAmount = calculateEmi(l.principal, l.annualRate, l.totalInstallments, 'monthly', 'reducing_monthly', 'rupee_nearest');
          loans.push(l);
        }
      }
    });
    setPreview({ name: f.name, loans, payments, errors });
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await call<{ loans: number; payments: number }>('import:apply', { loans: preview.loans, payments: preview.payments });
      await reload();
      toast({ kind: 'success', title: 'Import complete', body: `${r.loans} loan(s), ${r.payments} payment(s)` });
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Import failed — nothing was changed', body: (e as Error).message });
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Import from spreadsheet" sub="CSV exported from Excel or Google Sheets" onClose={onClose} size="wide"
      footer={<><button className="btn" onClick={onClose}>Cancel</button>{preview && <button className="btn primary" disabled={busy || (!preview.loans.length && !preview.payments.length)} onClick={apply}>Import {preview.loans.length + preview.payments.length} record(s)</button>}</>}>
      <div className="col">
        <Callout>
          <b>Loans CSV</b> columns: <span className="mono">name, lender, principal, annual_rate, installments, start_date, first_emi_date</span> (optional <span className="mono">emi, category, notes</span>).<br />
          <b>Payments CSV</b> columns: <span className="mono">loan, date, amount</span> (optional <span className="mono">type, installment, reference, notes</span>). Dates as YYYY-MM-DD or DD/MM/YYYY.
          Imported figures without an EMI are calculated and labelled as estimates.
        </Callout>
        <button className="btn" onClick={pick} style={{ alignSelf: 'flex-start' }}><FileSpreadsheet />Choose CSV file…</button>
        {preview && (
          <>
            <div className="small">From <b>{preview.name}</b>: {preview.loans.length} loan(s), {preview.payments.length} payment(s) ready.</div>
            {preview.errors.length > 0 && <Callout kind="warn">{preview.errors.length} row(s) skipped:<br />{preview.errors.slice(0, 8).map((e) => <div key={e}>{e}</div>)}{preview.errors.length > 8 && '…'}</Callout>}
            {preview.loans.length > 0 && <div className="small muted">{preview.loans.map((l) => l.name).join(', ')}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
