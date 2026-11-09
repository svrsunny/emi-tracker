import { useState } from 'react';
import { Download } from 'lucide-react';
import { toCsv } from '../../shared/csv';
import type { LoanComputation, ScheduleRow } from '../../shared/engine';
import type { Loan } from '../../shared/types';
import { call } from '../lib/api';
import { useStore } from '../lib/store';
import { PaymentForm } from './forms';
import { BtnGroup, Money, Projected, STATUS_LABEL, Status } from './ui';

export function scheduleCsv(loan: Loan, c: LoanComputation): string {
  return toCsv([
    ['Loan', 'No', 'EMI no', 'Due date', 'Rate %', 'Opening principal', 'Scheduled EMI', 'Interest', 'Principal due', 'Actual paid', 'Projected payment',
      'Principal paid', 'Interest paid', 'Fees & penalties', 'Additional principal', 'Capitalised', 'Closing principal', 'Unpaid', 'Dividend', 'Status', 'Remaining installments', 'Estimate'],
    ...c.rows.map((r) => [loan.name, r.no, r.emiNo ?? 'M', r.dueDate, r.rate, r.openingPrincipal, r.scheduledAmount, r.interest, r.principalDue, r.paidAmount, r.projectedAmount,
      r.paidPrincipal, r.paidInterest, r.feesCharged, r.extraPrincipal, r.capitalized, r.closingPrincipal, r.shortfall, r.dividend, STATUS_LABEL[r.status], r.remainingInstallments,
      r.isEstimated ? 'yes' : r.isProjected ? 'projected' : 'no']),
  ]);
}

export function ScheduleTable({ loan, comp, maxHeight = 560 }: { loan: Loan; comp: LoanComputation; maxHeight?: number }) {
  const { fmt, asOf } = useStore();
  const [view, setView] = useState<'all' | 'past' | 'future'>('all');
  const [pay, setPay] = useState<ScheduleRow | null>(null);
  const rows = comp.rows.filter((r) => view === 'all' || (view === 'past' ? r.dueDate <= asOf : r.dueDate > asOf));
  const chit = loan.loanType === 'chit_fund';
  return (
    <div className="col">
      <div className="row between wrap no-print">
        <BtnGroup value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'past', label: 'Elapsed' }, { value: 'future', label: 'Upcoming' }]} />
        <div className="row small muted">
          <span className="row" style={{ gap: 6 }}><Projected /> rows assume the EMI is paid on the due date</span>
          <button className="btn sm" onClick={() => call('export:save', { name: `${loan.name} - amortization.csv`, content: scheduleCsv(loan, comp), kind: 'csv' })}><Download />CSV</button>
        </div>
      </div>
      <div className="table-wrap card flush" style={{ maxHeight }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th><th>Due date</th><th className="num">Opening</th><th className="num">Scheduled EMI</th><th className="num">{chit ? 'Dividend' : 'Interest'}</th><th className="num">Principal</th>
              <th className="num">Actual paid</th><th className="num">Fees / pen.</th><th className="num">Extra principal</th><th className="num">Closing</th><th>Status</th><th className="num">Left</th><th className="no-print" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.no} className={r.isProjected && +r.paidAmount === 0 ? 'projected' : ''}>
                <td className="nowrap">{r.emiNo ?? <span className="faint">M{r.no}</span>}</td>
                <td className="nowrap">{fmt.date(r.dueDate)}{r.rate !== comp.rows[0]?.rate && <span className="tiny faint"> · {r.rate}%</span>}</td>
                <td className="num"><Money v={r.openingPrincipal} /></td>
                <td className="num"><Money v={r.scheduledAmount} /></td>
                <td className="num">{chit ? (+r.dividend > 0 ? <Money v={r.dividend} className="pos" /> : <span className="faint">—</span>) : <><Money v={r.interest} />{+r.capitalized > 0 && <div className="tiny warn">capitalised</div>}</>}</td>
                <td className="num"><Money v={r.principalDue} /></td>
                <td className="num">{+r.paidAmount > 0 ? <Money v={r.paidAmount} /> : r.isProjected ? <span className="faint"><Money v={r.projectedAmount} /></span> : <span className="faint">—</span>}{r.lastPaymentDate && <div className="tiny faint">{fmt.date(r.lastPaymentDate)}</div>}</td>
                <td className="num">{+r.feesCharged > 0 ? <Money v={r.feesCharged} className="warn" /> : <span className="faint">—</span>}</td>
                <td className="num">{+r.extraPrincipal > 0 ? <Money v={r.extraPrincipal} className="pos" /> : <span className="faint">—</span>}</td>
                <td className="num"><Money v={r.closingPrincipal} /></td>
                <td className="nowrap"><Status s={r.status} />{r.late && (r.status === 'paid' || r.status === 'partially_paid') && <span className="tiny neg"> · late</span>}{+r.shortfall > 0 && r.dueDate <= asOf && <div className="tiny warn">unpaid <Money v={r.shortfall} /></div>}</td>
                <td className="num">{r.kind === 'emi' ? r.remainingInstallments : ''}</td>
                <td className="no-print">{['upcoming', 'due', 'overdue', 'partially_paid', 'missed', 'unrecorded'].includes(r.status) && loan.status === 'active' && <button className="btn sm ghost" onClick={() => setPay(r)}>Pay</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pay && <PaymentForm loanId={loan.id} installmentNo={pay.no} onClose={() => setPay(null)} />}
    </div>
  );
}
