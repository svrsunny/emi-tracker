import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PieChart } from 'lucide-react';
import { monthlyExpenses, type ExpenseItem, type ExpenseKind } from '../../shared/bills';
import { addMonths } from '../../shared/dates';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { PaymentForm } from '../components/forms';
import { Card, Empty, Money } from '../components/ui';
import { BillPayDialog } from './Bills';

const KIND_LABEL: Record<ExpenseKind, string> = { loan: 'Loan EMIs', chit: 'Chit installments', bill: 'Bills' };
const KIND_COLOR: Record<ExpenseKind, string> = { loan: '#4f8cff', chit: '#a77bff', bill: '#f0a63a' };
const STATUS_TEXT: Record<ExpenseItem['status'], string> = { paid: 'Paid', partial: 'Part paid', due: 'Due today', overdue: 'Overdue', upcoming: 'Upcoming', no_record: 'No record' };

/** Everything that goes out in a month: EMIs, chit installments and bills, with what is paid and what is left. */
export function Expenses() {
  const { data, comps, fmt, asOf } = useStore();
  const { go } = useRouter();
  const [month, setMonth] = useState(asOf.slice(0, 7));
  const [payLoan, setPayLoan] = useState<ExpenseItem | null>(null);
  const [payBill, setPayBill] = useState<ExpenseItem | null>(null);
  const m = useMemo(() => monthlyExpenses({ loans: data.loans, comps, bills: data.bills, billPayments: data.billPayments, month, asOf }), [data, comps, month, asOf]);
  const shift = (n: number) => setMonth(addMonths(`${month}-01`, n).slice(0, 7));
  const all = +m.totals.all.expected;
  const kinds = (['loan', 'chit', 'bill'] as ExpenseKind[]).filter((k) => m.totals[k].count > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Monthly expenses</h1><p className="page-sub">Every EMI, chit installment and bill due in the month — what is paid and what is left.</p></div>
        <div className="row">
          <button className="btn icon" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></button>
          <div style={{ minWidth: 120, textAlign: 'center', fontWeight: 600 }}>{fmt.month(month)}</div>
          <button className="btn icon" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></button>
          {month !== asOf.slice(0, 7) && <button className="btn" onClick={() => setMonth(asOf.slice(0, 7))}>This month</button>}
        </div>
      </div>

      <div className="grid g3" style={{ marginBottom: 14 }}>
        <div className="card hero tight"><div className="stat-label">Total for {fmt.month(month)}</div><div className="stat-value lg"><Money v={m.totals.all.expected} /></div><div className="stat-foot">{m.totals.all.count} payment(s)</div></div>
        <div className="card tight"><div className="stat-label">Paid</div><div className="stat-value pos"><Money v={m.totals.all.paid} /></div></div>
        <div className="card tight"><div className="stat-label">Still to pay</div><div className={`stat-value ${+m.totals.all.remaining > 0 ? 'warn' : ''}`}><Money v={m.totals.all.remaining} /></div></div>
      </div>

      {all > 0 && (
        <Card title="Where the money goes">
          <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--surface-2)' }} aria-hidden>
            {kinds.map((k) => <div key={k} style={{ width: `${(+m.totals[k].expected / all) * 100}%`, background: KIND_COLOR[k] }} />)}
          </div>
          <div className="grid g3" style={{ marginTop: 12 }}>
            {kinds.map((k) => (
              <div key={k}>
                <div className="row small"><span style={{ width: 10, height: 10, borderRadius: 3, background: KIND_COLOR[k], display: 'inline-block' }} />{KIND_LABEL[k]} · {Math.round((+m.totals[k].expected / all) * 100)}%</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}><Money v={m.totals[k].expected} /></div>
                <div className="tiny faint">Paid <Money v={m.totals[k].paid} /> · left <Money v={m.totals[k].remaining} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ marginTop: 14 }} />
      <Card flush title="Payments this month">
        {!m.items.length ? <Empty icon={<PieChart />} title="Nothing due this month">Loans, chits and bills due in {fmt.month(month)} appear here.</Empty> : (
          <table className="data">
            <thead><tr><th>Due</th><th>What</th><th>Type</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Left</th><th>Status</th><th /></tr></thead>
            <tbody>
              {m.items.map((x) => (
                <tr key={`${x.kind}-${x.refId}-${x.dueDate}`}>
                  <td className="nowrap">{fmt.date(x.dueDate)}</td>
                  <td><button className="link-btn" onClick={() => go(x.kind === 'bill' ? '/bills' : `/loans/${x.refId}`)}><b>{x.name}</b></button><div className="tiny faint">{x.detail}</div></td>
                  <td><span className="row small" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[x.kind], display: 'inline-block' }} />{KIND_LABEL[x.kind].replace(/s$/, '')}</span></td>
                  <td className="num"><Money v={x.expected} /></td>
                  <td className="num">{+x.paid > 0 ? <Money v={x.paid} /> : <span className="faint">—</span>}</td>
                  <td className="num">{+x.remaining > 0 ? <Money v={x.remaining} /> : <span className="faint">—</span>}</td>
                  <td><span className={`status s-${x.status}`}>{STATUS_TEXT[x.status]}</span></td>
                  <td className="right">
                    {x.status !== 'paid' && (x.kind === 'bill'
                      ? <button className="btn sm" onClick={() => setPayBill(x)}>Mark paid</button>
                      : <button className="btn sm" onClick={() => setPayLoan(x)}>Pay</button>)}
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}><td colSpan={3}>Total</td><td className="num"><Money v={m.totals.all.expected} /></td><td className="num"><Money v={m.totals.all.paid} /></td><td className="num"><Money v={m.totals.all.remaining} /></td><td colSpan={2} /></tr>
            </tbody>
          </table>
        )}
      </Card>
      {payLoan && <PaymentForm loanId={payLoan.refId} installmentNo={payLoan.rowNo ?? undefined} onClose={() => setPayLoan(null)} />}
      {payBill && <BillPayDialog bill={data.bills.find((b) => b.id === payBill.refId)!} dueDate={payBill.dueDate} onClose={() => setPayBill(null)} />}
    </div>
  );
}
