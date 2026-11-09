import { useMemo, useState, type ReactNode } from 'react';
import { Download, FileDown, Printer } from 'lucide-react';
import { activity, annualSummary, financialYearSummary, type Portfolio } from '../../shared/aggregate';
import { toCsv } from '../../shared/csv';
import { useStore } from '../lib/store';
import { call } from '../lib/api';
import type { PrintDoc } from '../../shared/print';
import { Callout, Card, Estimate, LOAN_TYPE_LABEL, PAYMENT_TYPE_LABEL, STATUS_LABEL } from '../components/ui';
import { YearBars } from '../components/charts';
import { LoanFilter } from './Dashboard';
import { ScheduleTable, scheduleCsv } from '../components/ScheduleTable';

type ReportId = 'summary' | 'payments' | 'schedule' | 'annual' | 'interest' | 'principal' | 'late' | 'closures' | 'savings' | 'tax';
const REPORTS: { id: ReportId; label: string; desc: string }[] = [
  { id: 'summary', label: 'Loan summary', desc: 'Every loan: borrowed, paid, outstanding, remaining' },
  { id: 'payments', label: 'Payment history', desc: 'Full ledger with allocation' },
  { id: 'schedule', label: 'Amortization schedule', desc: 'Installment-by-installment for one loan' },
  { id: 'annual', label: 'Annual repayment summary', desc: 'Totals per calendar year' },
  { id: 'interest', label: 'Interest paid', desc: 'Interest by loan and month' },
  { id: 'principal', label: 'Principal repaid', desc: 'Principal by loan and month' },
  { id: 'late', label: 'Missed & late payments', desc: 'Installments paid late, overdue or missed' },
  { id: 'closures', label: 'Forecasted closures', desc: 'Projected closure dates and remaining cost' },
  { id: 'savings', label: 'Prepayment savings', desc: 'Interest and time saved vs contract' },
  { id: 'tax', label: 'Financial-year totals', desc: 'Principal & interest per FY (Apr–Mar)' },
];

export function Reports() {
  const { data, comps, fmt, asOf, toast } = useStore();
  const [id, setId] = useState<ReportId>('summary');
  const [loanId, setLoanId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const portfolio: Portfolio = { loans: data.loans, comps, payments: data.payments };
  const f = { loanIds: loanId ? [loanId] : null, from: from || null, to: to || null };
  const loans = data.loans.filter((l) => !loanId || l.id === loanId);
  const name = (lid: string) => data.loans.find((l) => l.id === lid)?.name ?? '';

  const table = useMemo((): { head: string[]; rows: (string | number)[][]; money: number[] } => {
    switch (id) {
      case 'summary': return {
        head: ['Loan', 'Lender', 'Status', 'Principal', 'Principal repaid', 'Interest paid', 'Fees & charges', 'Total paid', 'Outstanding principal', 'Installments left', 'Remaining outflow', 'Closure'],
        money: [3, 4, 5, 6, 7, 8, 10],
        rows: loans.map((l) => { const s = comps.get(l.id)!.summary; return [l.name, l.lender, l.status[0].toUpperCase() + l.status.slice(1), s.principal, s.principalRepaid, s.interestPaid, (+s.feesPaid + +s.penaltiesPaid).toFixed(2), s.totalPaid, s.outstandingPrincipal, s.installmentsRemaining, s.remainingCashOutflow, s.closureDate ?? '']; }),
      };
      case 'payments': return {
        head: ['Date', 'Loan', 'Type', 'Amount', 'Principal', 'Interest', 'Fees', 'Penalty', 'Reference', 'Status'], money: [3, 4, 5, 6, 7],
        rows: data.payments.filter((p) => (!loanId || p.loanId === loanId) && (!from || p.txnDate >= from) && (!to || p.txnDate <= to)).sort((a, b) => a.txnDate.localeCompare(b.txnDate)).map((p) => {
          const a = comps.get(p.loanId)?.allocations[p.id];
          return [p.txnDate, name(p.loanId), PAYMENT_TYPE_LABEL[p.type], p.amount, a?.principal ?? '', a?.interest ?? '', a?.fees ?? '', a?.penalty ?? '', p.reference, p.status];
        }),
      };
      case 'annual': return { head: ['Year', 'Payments', 'Total paid', 'Principal', 'Interest', 'Fees'], money: [2, 3, 4, 5], rows: annualSummary(portfolio, f).map((y) => [y.year, y.count, y.paid, y.principal, y.interest, y.fees]) };
      case 'interest':
      case 'principal': {
        const key = id;
        const map = new Map<string, number>();
        for (const a of activity(portfolio, f)) { const k = `${a.date.slice(0, 7)}|${a.loanId}`; map.set(k, (map.get(k) ?? 0) + a[key].toNumber()); }
        return { head: ['Month', 'Loan', key === 'interest' ? 'Interest paid' : 'Principal repaid'], money: [2], rows: [...map.entries()].sort().map(([k, v]) => { const [m, l] = k.split('|'); return [m, name(l), v.toFixed(2)]; }) };
      }
      case 'late': return {
        head: ['Loan', 'Installment', 'Due date', 'Status', 'Paid on', 'Scheduled', 'Unpaid', 'Charges (est.)'], money: [5, 6, 7],
        rows: loans.flatMap((l) => comps.get(l.id)!.rows.filter((r) => r.dueDate <= asOf && (r.late || ['overdue', 'missed', 'partially_paid'].includes(r.status)) && (!from || r.dueDate >= from) && (!to || r.dueDate <= to))
          .map((r) => [l.name, r.emiNo ?? r.no, r.dueDate, STATUS_LABEL[r.status] + (r.late && r.status === 'paid' ? ' (late)' : ''), r.lastPaymentDate ?? '', r.scheduledAmount, r.shortfall, r.feesCharged])),
      };
      case 'closures': return {
        head: ['Loan', 'Outstanding', 'EMI', 'Installments left', 'Remaining interest', 'Remaining outflow', 'Projected closure', 'Contract closure'], money: [1, 2, 4, 5],
        rows: loans.filter((l) => l.status === 'active').map((l) => { const s = comps.get(l.id)!.summary; return [l.name, s.outstandingPrincipal, s.currentEmi, s.installmentsRemaining, s.remainingInterest, s.remainingCashOutflow, s.closureDate ?? (s.nonConverging ? 'never' : ''), s.baselineClosureDate ?? '']; }),
      };
      case 'savings': return {
        head: ['Loan', 'Prepaid principal', 'Contract interest', 'Lifetime interest now', 'Interest saved', 'Installments saved', 'Contract closure', 'Projected closure'], money: [1, 2, 3, 4],
        rows: loans.map((l) => {
          const c = comps.get(l.id)!;
          // extra principal from prepayments and EMI overpayments (recorded only; no simulations here)
          const prepaid = c.rows.reduce((sum, r) => sum + +r.extraPrincipal, 0);
          return [l.name, prepaid.toFixed(2), c.summary.baselineTotalInterest, c.summary.lifetimeInterest, c.summary.interestSaved, c.summary.periodsSaved, c.summary.baselineClosureDate ?? '', c.summary.closureDate ?? ''];
        }),
      };
      case 'tax': {
        const rows: (string | number)[][] = [];
        for (const l of loans) for (const fy of financialYearSummary(portfolio, { ...f, loanIds: [l.id] })) rows.push([fy.fy, l.name, LOAN_TYPE_LABEL[l.loanType], fy.principal, fy.interest, fy.paid]);
        return { head: ['Financial year', 'Loan', 'Type', 'Principal repaid', 'Interest paid', 'Total paid'], money: [3, 4, 5], rows: rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
      }
      default: return { head: [], rows: [], money: [] };
    }
  }, [id, data, comps, loanId, from, to, asOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleLoan = data.loans.find((l) => l.id === (loanId || data.loans[0]?.id));
  const report = REPORTS.find((r) => r.id === id)!;
  const csv = () => id === 'schedule' && scheduleLoan ? scheduleCsv(scheduleLoan, comps.get(scheduleLoan.id)!) : toCsv([table.head, ...table.rows]);

  const totals = table.money.length && table.rows.length ? table.head.map((_, i) => (table.money.includes(i) ? table.rows.reduce((s, r) => s + (+r[i] || 0), 0) : null)) : null;

  const printDocument = (): PrintDoc => {
    const subtitle = `Generated ${fmt.date(asOf)}${loanId ? ` · ${name(loanId)}` : ''}${from || to ? ` · ${from ? fmt.date(from) : '…'} to ${to ? fmt.date(to) : '…'}` : ''}`;
    const note = id === 'tax' ? 'Principal and interest actually paid per Indian financial year (April–March), for reference only. Not tax advice.'
      : id === 'closures' || id === 'savings' ? 'Projection: assumes every future EMI is paid on its due date.' : undefined;
    if (id === 'schedule') {
      if (!scheduleLoan) return { title: report.label, subtitle, head: ['Schedule'], align: ['left'], rows: [] };
      const c = comps.get(scheduleLoan.id)!;
      const opt = (v: string) => (+v > 0 ? fmt.money(v) : '—');
      return {
        title: `${report.label} — ${scheduleLoan.name}`, subtitle, note: 'Projected rows (in brackets) assume the EMI is paid on its due date.',
        summary: [
          { label: 'Principal', value: fmt.money(c.summary.principal) }, { label: 'Current EMI', value: fmt.money(c.summary.currentEmi) },
          { label: 'Outstanding', value: fmt.money(c.summary.outstandingPrincipal) }, { label: 'Paid', value: `${c.summary.installmentsPaid} of ${c.summary.totalInstallments}` },
          { label: 'Closure', value: fmt.date(c.summary.closureDate) },
        ],
        head: ['#', 'Due date', 'Opening', 'EMI', scheduleLoan.loanType === 'chit_fund' ? 'Dividend' : 'Interest', 'Principal', 'Paid', 'Fees / penalty', 'Extra principal', 'Closing', 'Status', 'Left'],
        align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'right'],
        rows: c.rows.map((r) => [
          r.emiNo ? String(r.emiNo) : `M${r.no}`, fmt.date(r.dueDate), fmt.money(r.openingPrincipal), fmt.money(r.scheduledAmount), scheduleLoan.loanType === 'chit_fund' ? opt(r.dividend) : fmt.money(r.interest), fmt.money(r.principalDue),
          +r.paidAmount > 0 ? fmt.money(r.paidAmount) : r.isProjected ? `(${fmt.money(r.projectedAmount)})` : '—', opt(r.feesCharged), opt(r.extraPrincipal), fmt.money(r.closingPrincipal),
          STATUS_LABEL[r.status] + (r.late && (r.status === 'paid' || r.status === 'partially_paid') ? ' (late)' : ''), r.kind === 'emi' ? String(r.remainingInstallments) : '',
        ]),
      };
    }
    const isDate = (c: string | number) => /^\d{4}-\d{2}-\d{2}$/.test(String(c));
    const numeric = table.head.map((_, j) => table.money.includes(j) || (table.rows.length > 0 && table.rows.every((r) => r[j] === '' || typeof r[j] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[j])))));
    const summary = id === 'summary' && totals ? [
      { label: 'Loans', value: String(table.rows.length) }, { label: 'Principal', value: fmt.money(totals[3] ?? 0) }, { label: 'Total paid', value: fmt.money(totals[7] ?? 0) },
      { label: 'Outstanding', value: fmt.money(totals[8] ?? 0) }, { label: 'Still to pay', value: fmt.money(totals[10] ?? 0) },
    ] : undefined;
    return {
      title: report.label, subtitle, note, summary, head: table.head, align: numeric.map((n) => (n ? 'right' : 'left')),
      rows: table.rows.map((r) => r.map((c, j) => (table.money.includes(j) && c !== '' ? fmt.money(c) : isDate(c) ? fmt.date(String(c)) : String(c)))),
      totals: totals ? totals.map((t, i) => (i === 0 ? 'Total' : t !== null ? fmt.money(t) : '')) : null,
    };
  };
  const pdf = async () => {
    try {
      const saved = await call<string | null>('report:pdf', { name: `${printDocument().title}.pdf`, doc: printDocument() });
      if (saved) toast({ kind: 'success', title: 'PDF saved', body: saved });
    } catch (e) { toast({ kind: 'error', title: 'Could not create PDF', body: (e as Error).message }); }
  };

  let body: ReactNode;
  if (id === 'schedule') body = scheduleLoan ? <ScheduleTable loan={scheduleLoan} comp={comps.get(scheduleLoan.id)!} maxHeight={100000} /> : <p className="muted">No loans.</p>;
  else body = (
    <div className="table-wrap">
      <table className="data">
        <thead><tr>{table.head.map((h, i) => <th key={h} className={table.money.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={table.money.includes(j) ? 'num' : ''}>{table.money.includes(j) && c !== '' ? fmt.money(c) : /^\d{4}-\d{2}-\d{2}$/.test(String(c)) ? fmt.date(String(c)) : c}</td>)}</tr>)}
          {!table.rows.length && <tr><td colSpan={table.head.length} className="muted">No data for these filters.</td></tr>}
          {totals && <tr style={{ fontWeight: 600 }}>{totals.map((t, i) => <td key={i} className={t !== null ? 'num' : ''}>{i === 0 ? 'Total' : t !== null ? fmt.money(t) : ''}</td>)}</tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head no-print">
        <div><h1 className="page-title">Reports & analytics</h1><p className="page-sub">Export as CSV, print, or save as PDF — generated locally.</p></div>
        <div className="row wrap">
          <LoanFilter value={loanId} onChange={setLoanId} />
          <input className="input" type="date" style={{ width: 140, height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input className="input" type="date" style={{ width: 140, height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>
        <div className="col no-print" style={{ gap: 4 }}>
          {REPORTS.map((r) => (
            <button key={r.id} className={`nav-item ${r.id === id ? 'active' : ''}`} onClick={() => setId(r.id)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
              <span>{r.label}</span><span className="tiny faint">{r.desc}</span>
            </button>
          ))}
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="print-only"><h2 style={{ margin: 0 }}>EMI Tracker — {report.label}</h2><p>Generated {fmt.date(asOf)}{loanId ? ` · ${name(loanId)}` : ''}{from || to ? ` · ${from || '…'} to ${to || '…'}` : ''}</p></div>
          <Card title={report.label} sub={report.desc} actions={
            <div className="row no-print">
              <button className="btn sm" onClick={() => call('export:save', { name: `${report.label}.csv`, content: csv(), kind: 'csv' })}><Download />CSV</button>
              <button className="btn sm" onClick={() => call('report:print', { doc: printDocument() }).catch((e: Error) => toast({ kind: 'error', title: 'Could not print', body: e.message }))}><Printer />Print</button>
              <button className="btn sm" onClick={pdf}><FileDown />PDF</button>
            </div>
          }>
            {id === 'tax' && <div style={{ marginBottom: 10 }}><Callout kind="warn">Totals of principal and interest you actually paid per Indian financial year, for reference. Eligibility for any tax deduction depends on your situation and current law — this is not tax advice. Check with your lender's interest certificate.</Callout></div>}
            {id === 'annual' && table.rows.length > 0 && <YearBars data={annualSummary(portfolio, f)} />}
            {(id === 'closures' || id === 'savings') && <div style={{ marginBottom: 8 }}><Estimate label="Projection" /> <span className="small muted">Assumes future EMIs are paid on schedule.</span></div>}
            {body}
          </Card>
        </div>
      </div>
    </div>
  );
}
