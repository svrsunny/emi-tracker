import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dailyCells, type DayCell } from '../../shared/aggregate';
import { billOccurrences, spendingByDay, spendTotals, type BillOccurrence, type SpendEntry, type SpendKind } from '../../shared/bills';
import { addDays, addMonths, endOfMonth, startOfMonth, weekday } from '../../shared/dates';
import type { Bill } from '../../shared/types';
import { useStore } from '../lib/store';
import { PaymentForm } from '../components/forms';
import { STATE_COLORS, StateLegend } from '../components/heatmap';
import { Card, Money, Status } from '../components/ui';
import { BillPayDialog } from './Bills';
import { LoanFilter } from './Dashboard';

export const SPEND_LABEL: Record<SpendKind, string> = { loan: 'Loan EMIs', chit: 'Chits', bill: 'Bills', one_time: 'One-time' };
const BILL_STATE = { paid: 'paid', overdue: 'overdue', due: 'due', upcoming: 'upcoming', partial: 'partial', no_record: 'none' } as const;

export function Calendar() {
  const { data, comps, asOf, fmt, prefs } = useStore();
  const [month, setMonth] = useState(startOfMonth(asOf));
  const [loanId, setLoanId] = useState('');
  const [sel, setSel] = useState<string>(asOf);
  const [pay, setPay] = useState<{ loanId: string; no: number } | null>(null);
  const [payBill, setPayBill] = useState<{ bill: Bill; dueDate: string } | null>(null);
  const gridStart = addDays(month, -((weekday(month) - prefs.weekStart + 7) % 7));
  const gridEnd = addDays(gridStart, 41);
  const monthEnd = endOfMonth(month);
  const cells = useMemo(() => dailyCells({ loans: data.loans, comps, payments: data.payments }, gridStart, gridEnd, asOf, { loanIds: loanId ? [loanId] : null }), [data, comps, gridStart, gridEnd, asOf, loanId]);
  // bills due on each day (only when not looking at a single loan)
  const billsDue = useMemo(() => {
    const m = new Map<string, BillOccurrence[]>();
    if (!loanId) for (const o of billOccurrences(data.bills, data.billPayments, gridStart, gridEnd, asOf)) m.set(o.dueDate, [...(m.get(o.dueDate) ?? []), o]);
    return m;
  }, [data.bills, data.billPayments, gridStart, gridEnd, asOf, loanId]);
  const spent = useMemo(() => spendingByDay({ loans: data.loans, payments: data.payments, bills: data.bills, billPayments: data.billPayments, from: gridStart, to: gridEnd, loanIds: loanId ? [loanId] : null }),
    [data, gridStart, gridEnd, loanId]);
  const loanName = (id: string) => data.loans.find((l) => l.id === id)?.name ?? '';
  const dows = prefs.weekStart === 1 ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const inMonth = (d: string) => d >= month && d <= monthEnd;
  const monthSpent = spendTotals([...spent].filter(([d]) => inMonth(d)).flatMap(([, xs]) => xs));
  const monthDue = [...cells.values()].filter((c) => inMonth(c.date)).reduce((s, c) => s + c.scheduled.reduce((x, y) => x + +y.amount, 0), 0)
    + [...billsDue].filter(([d]) => inMonth(d)).flatMap(([, xs]) => xs).reduce((s, o) => s + +(o.payment?.amount ?? o.bill.amount), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Calendar</h1><p className="page-sub">EMIs, chits and bills due, and what you actually paid each day</p></div>
        <div className="row wrap">
          <LoanFilter value={loanId} onChange={setLoanId} />
          <button className="btn icon" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft /></button>
          <b style={{ minWidth: 110, textAlign: 'center' }}>{fmt.month(month.slice(0, 7))}</b>
          <button className="btn icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight /></button>
          <button className="btn" onClick={() => { setMonth(startOfMonth(asOf)); setSel(asOf); }}>Today</button>
        </div>
      </div>
      <div className="grid g3">
        <Card className="span2" title={`${fmt.month(month.slice(0, 7))}`} sub={<>Due {fmt.money(monthDue)} · spent <b>{fmt.money(monthSpent.all)}</b>{loanId ? '' : ` (${(['loan', 'chit', 'bill', 'one_time'] as SpendKind[]).filter((k) => +monthSpent[k] > 0).map((k) => `${SPEND_LABEL[k]} ${fmt.money(monthSpent[k])}`).join(' · ') || 'nothing yet'})`}</>}>
          <div className="cal" role="grid" aria-label="Payment calendar">
            {dows.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {Array.from({ length: 42 }, (_, i) => {
              const d = addDays(gridStart, i);
              const c = cells.get(d)!;
              const bills = billsDue.get(d) ?? [];
              const daySpent = spendTotals(spent.get(d) ?? []).all;
              const other = d < month || d > monthEnd;
              const chips = [
                ...c.scheduled.map((s) => ({ key: `${s.loanId}-${s.no}`, name: loanName(s.loanId), amount: s.amount, color: STATE_COLORS[chipState(s.status)] })),
                ...bills.map((o) => ({ key: `${o.bill.id}-${o.dueDate}`, name: o.bill.name, amount: o.payment?.amount ?? o.bill.amount, color: STATE_COLORS[BILL_STATE[o.status]] })),
              ];
              return (
                <button key={d} className={`cal-day ${other ? 'other' : ''} ${d === asOf ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)}
                  aria-label={`${fmt.date(d)}: ${chips.length} due${+daySpent > 0 ? `, spent ${fmt.money(daySpent)}` : ''}`} aria-selected={d === sel}>
                  <span className="cal-num">{+d.slice(8)}</span>
                  {chips.slice(0, 3).map((ch) => (
                    <span key={ch.key} className="cal-chip" style={{ color: ch.color }}><span style={{ color: 'var(--text)' }}>{ch.name}</span> <span className="money" style={{ color: 'var(--text-2)' }}>{fmt.compact(ch.amount)}</span></span>
                  ))}
                  {chips.length > 3 && <span className="tiny faint">+{chips.length - 3} more</span>}
                  {+daySpent > 0 && <span className="cal-chip" style={{ color: 'var(--positive)' }}><span style={{ color: 'var(--text)' }}>Spent</span> <span className="money" style={{ color: 'var(--text-2)' }}>{fmt.compact(daySpent)}</span></span>}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 12 }}><StateLegend /></div>
        </Card>
        <Card title={fmt.date(sel)} sub={sel === asOf ? 'Today' : sel < asOf ? 'Past' : 'Upcoming'}>
          {cells.get(sel) && <DayPanel c={cells.get(sel)!} bills={billsDue.get(sel) ?? []} spent={spent.get(sel) ?? []}
            onPay={(l, no) => setPay({ loanId: l, no })} onPayBill={(bill, dueDate) => setPayBill({ bill, dueDate })} />}
        </Card>
      </div>
      {pay && <PaymentForm loanId={pay.loanId} installmentNo={pay.no} onClose={() => setPay(null)} />}
      {payBill && <BillPayDialog bill={payBill.bill} dueDate={payBill.dueDate} onClose={() => setPayBill(null)} />}
    </div>
  );
}

function chipState(s: string) {
  return ({ paid: 'paid', assumed_paid: 'paid', prepaid: 'prepaid', partially_paid: 'partial', overdue: 'overdue', missed: 'missed', due: 'due', upcoming: 'upcoming', waived: 'waived' } as Record<string, keyof typeof STATE_COLORS>)[s] ?? 'none';
}

const BILL_STATUS_TEXT = { paid: 'Paid', overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming', partial: 'Part paid', no_record: 'No record' } as const;

function DayPanel({ c, bills, spent, onPay, onPayBill }: { c: DayCell; bills: BillOccurrence[]; spent: SpendEntry[]; onPay: (loanId: string, no: number) => void; onPayBill: (bill: Bill, dueDate: string) => void }) {
  const { data, comps, fmt } = useStore();
  if (!c.scheduled.length && !bills.length && !spent.length) return <p className="muted">Nothing due or paid on this day.</p>;
  const total = spendTotals(spent);
  return (
    <div className="col">
      {(c.scheduled.length > 0 || bills.length > 0) && <div className="field-label">Due</div>}
      {c.scheduled.map((s) => {
        const l = data.loans.find((x) => x.id === s.loanId)!;
        const r = comps.get(s.loanId)?.rows.find((x) => x.no === s.no);
        return (
          <div key={`${s.loanId}-${s.no}`} className="card tight" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            <div className="row between"><b>{l.name}</b><Status s={s.status} /></div>
            <div className="row between small muted"><span>{l.loanType === 'chit_fund' ? 'Installment' : 'EMI'} #{r?.emiNo ?? s.no}</span><Money v={s.amount} /></div>
            {r && +r.shortfall > 0 && l.status === 'active' && <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => onPay(l.id, s.no)}>Record payment</button>}
          </div>
        );
      })}
      {bills.map((o) => (
        <div key={`${o.bill.id}-${o.dueDate}`} className="card tight" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
          <div className="row between"><b>{o.bill.name}</b><span className={`small s-${o.status}`}>{BILL_STATUS_TEXT[o.status]}</span></div>
          <div className="row between small muted"><span>{o.bill.frequency === 'once' ? 'One-time expense' : 'Bill'}</span><Money v={o.payment?.amount ?? o.bill.amount} /></div>
          {!o.payment && o.bill.active && <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => onPayBill(o.bill, o.dueDate)}>Mark paid</button>}
        </div>
      ))}
      {spent.length > 0 && (
        <>
          <div className="row between" style={{ marginTop: 6 }}><span className="field-label">Spent on this day</span><b className="money">{fmt.money(total.all)}</b></div>
          {spent.map((x) => (
            <div key={x.id} className="row between small"><span>{x.name} <span className="faint">· {SPEND_LABEL[x.kind]}</span></span><span className="pos"><Money v={x.amount} /></span></div>
          ))}
        </>
      )}
      <div className="tiny faint">{fmt.date(c.date)}</div>
    </div>
  );
}
