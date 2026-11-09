import { useMemo, useState } from 'react';
import { Ban, CheckSquare, Download, Edit3, Paperclip, Plus, Receipt, Undo2 } from 'lucide-react';
import { toCsv } from '../../shared/csv';
import { endOfMonth } from '../../shared/dates';
import type { Payment, PaymentType } from '../../shared/types';
import { call } from '../lib/api';
import { useRouter } from '../lib/router';
import { useAction, useStore } from '../lib/store';
import { PaymentForm, ReverseDialog } from '../components/forms';
import { Card, Empty, Money, PAYMENT_TYPE_LABEL, Status } from '../components/ui';

export function Payments() {
  const { data, comps, fmt, asOf } = useStore();
  const [form, setForm] = useState<{ type?: PaymentType } | null>(null);
  const overdue = data.loans.filter((l) => l.status === 'active').flatMap((l) => (comps.get(l.id)?.rows ?? []).filter((r) => ['overdue', 'missed', 'partially_paid', 'due'].includes(r.status) && r.dueDate <= asOf).map((r) => ({ l, r })));
  const [quick, setQuick] = useState<{ loanId: string; no: number } | null>(null);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Payment tracker</h1><p className="page-sub">Every recorded transaction. Corrections are made by editing or reversing — history is never deleted.</p></div>
        <div className="row wrap">
          <button className="btn" onClick={() => setForm({ type: 'prepayment' })}>Prepayment</button>
          <button className="btn" onClick={() => setForm({ type: 'missed' })}>Mark missed</button>
          <button className="btn primary" onClick={() => setForm({})}><Plus />Record payment</button>
        </div>
      </div>
      {overdue.length > 0 && (
        <Card title={`Needs attention (${overdue.length})`} sub="Installments due or past due without a full payment record" className="no-print">
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table className="data">
              <tbody>
                {overdue.map(({ l, r }) => (
                  <tr key={`${l.id}-${r.no}`}>
                    <td>{l.name}</td><td>EMI #{r.emiNo ?? r.no}</td><td className="muted">due {fmt.date(r.dueDate)}</td><td><Status s={r.status} /></td><td className="num"><Money v={r.shortfall} /></td>
                    <td className="right"><button className="btn sm primary" onClick={() => setQuick({ loanId: l.id, no: r.no })}>Mark paid…</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div style={{ marginTop: 14 }}><PaymentLedger /></div>
      {form && <PaymentForm presetType={form.type} onClose={() => setForm(null)} />}
      {quick && <PaymentForm loanId={quick.loanId} installmentNo={quick.no} onClose={() => setQuick(null)} />}
    </div>
  );
}

/** Filterable ledger; used on the payments page and inside each loan. */
export function PaymentLedger({ loanId }: { loanId?: string }) {
  const { data, comps, fmt } = useStore();
  const { route } = useRouter();
  const act = useAction();
  const month = route.query.get('month');
  const highlight = route.query.get('highlight');
  const dateParam = route.query.get('date');
  const [loan, setLoan] = useState(loanId ?? route.query.get('loan') ?? '');
  const [from, setFrom] = useState(month ? `${month}-01` : dateParam ?? '');
  const [to, setTo] = useState(month ? endOfMonth(`${month}-01`) : dateParam ?? '');
  const [type, setType] = useState('');
  const [state, setState] = useState<'active' | 'reversed' | 'all'>('all');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [component, setComponent] = useState<'' | 'principal' | 'interest'>('');
  const [lender, setLender] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Payment | null>(null);
  const [reverse, setReverse] = useState<Payment | null>(null);

  const loanById = useMemo(() => new Map(data.loans.map((l) => [l.id, l])), [data.loans]);
  const rows = useMemo(() => data.payments.filter((p) => {
    const l = loanById.get(p.loanId);
    const a = comps.get(p.loanId)?.allocations[p.id];
    if (loan && p.loanId !== loan) return false;
    if (from && p.txnDate < from) return false;
    if (to && p.txnDate > to) return false;
    if (type && p.type !== type) return false;
    if (state !== 'all' && p.status !== state) return false;
    if (min && +p.amount < +min) return false;
    if (max && +p.amount > +max) return false;
    if (lender && l?.lender !== lender) return false;
    if (component === 'principal' && !(a && +a.principal > +a.interest)) return false;
    if (component === 'interest' && !(a && +a.interest >= +a.principal)) return false;
    if (q) {
      const hay = `${p.reference} ${p.notes} ${l?.name} ${p.amount}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.createdAt.localeCompare(a.createdAt)), [data.payments, loanById, comps, loan, from, to, type, state, min, max, lender, component, q]);

  const totals = rows.filter((p) => p.status === 'active').reduce((s, p) => {
    const a = comps.get(p.loanId)?.allocations[p.id];
    return { amount: s.amount + +p.amount, principal: s.principal + +(a?.principal ?? 0), interest: s.interest + +(a?.interest ?? 0), fees: s.fees + +(a?.fees ?? 0) + +(a?.penalty ?? 0) };
  }, { amount: 0, principal: 0, interest: 0, fees: 0 });

  const exportCsv = () => call('export:save', {
    name: 'payment-history.csv', kind: 'csv', content: toCsv([
      ['Date', 'Loan', 'Lender', 'Type', 'Installment', 'Due date', 'Amount', 'Principal', 'Interest', 'Fees', 'Penalty', 'Unapplied', 'Allocation', 'Reference', 'Reconciled', 'Status', 'Reversal reason', 'Notes'],
      ...rows.map((p) => {
        const l = loanById.get(p.loanId);
        const a = comps.get(p.loanId)?.allocations[p.id];
        const r = comps.get(p.loanId)?.rows.find((x) => x.no === p.installmentNo);
        return [p.txnDate, l?.name, l?.lender, PAYMENT_TYPE_LABEL[p.type], r?.emiNo ?? p.installmentNo ?? '', r?.dueDate ?? '', p.amount, a?.principal, a?.interest, a?.fees, a?.penalty, a?.unapplied,
          p.manualAllocation ? 'lender' : 'calculated', p.reference, p.reconciled ? 'yes' : 'no', p.status, p.reversalReason, p.notes];
      }),
    ]),
  });

  const lenders = [...new Set(data.loans.map((l) => l.lender).filter(Boolean))];
  return (
    <Card flush title={<span>{rows.length} transaction(s)</span>} sub={<>Total <b className="money">{fmt.money(totals.amount)}</b> · principal {fmt.money(totals.principal)} · interest {fmt.money(totals.interest)} · fees {fmt.money(totals.fees)}</>}
      actions={<button className="btn sm" onClick={exportCsv}><Download />Export CSV</button>}>
      <div className="row wrap no-print" style={{ padding: '0 16px 12px', gap: 8 }}>
        {!loanId && (
          <select className="input" style={{ width: 170, height: 30 }} value={loan} onChange={(e) => setLoan(e.target.value)} aria-label="Loan"><option value="">All loans</option>{data.loans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        )}
        {!loanId && lenders.length > 1 && <select className="input" style={{ width: 150, height: 30 }} value={lender} onChange={(e) => setLender(e.target.value)} aria-label="Lender"><option value="">All lenders</option>{lenders.map((x) => <option key={x}>{x}</option>)}</select>}
        <select className="input" style={{ width: 150, height: 30 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Transaction type"><option value="">All types</option>{Object.entries(PAYMENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input" style={{ width: 130, height: 30 }} value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="Record status"><option value="all">Active + reversed</option><option value="active">Active only</option><option value="reversed">Reversed only</option></select>
        <select className="input" style={{ width: 150, height: 30 }} value={component} onChange={(e) => setComponent(e.target.value as typeof component)} aria-label="Mostly principal or interest"><option value="">Principal & interest</option><option value="principal">Mostly principal</option><option value="interest">Mostly interest</option></select>
        <input className="input" type="date" style={{ width: 140, height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" style={{ width: 140, height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <input className="input" style={{ width: 90, height: 30 }} placeholder="Min ₹" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Minimum amount" />
        <input className="input" style={{ width: 90, height: 30 }} placeholder="Max ₹" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Maximum amount" />
        <input className="input grow" style={{ minWidth: 140, height: 30 }} placeholder="Search reference / notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      </div>
      {!rows.length ? <Empty icon={<Receipt />} title="No transactions">{data.payments.length ? 'No payments match these filters.' : 'Record your first EMI payment to start tracking.'}</Empty> : (
        <div className="table-wrap" style={{ maxHeight: 620 }}>
          <table className="data">
            <thead><tr><th>Date</th>{!loanId && <th>Loan</th>}<th>Type</th><th>Installment</th><th className="num">Amount</th><th className="num">Principal</th><th className="num">Interest</th><th className="num">Fees/pen.</th><th>Reference</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const l = loanById.get(p.loanId);
                const c = comps.get(p.loanId);
                const a = c?.allocations[p.id];
                const r = c?.rows.find((x) => x.no === p.installmentNo);
                return (
                  <tr key={p.id} className={`${p.status === 'reversed' ? 'reversed' : ''} ${highlight === p.id ? 'highlight' : ''}`}>
                    <td className="nowrap">{fmt.date(p.txnDate)}</td>
                    {!loanId && <td>{l?.name}</td>}
                    <td className="nowrap">{PAYMENT_TYPE_LABEL[p.type]}{p.manualAllocation && <span className="tag" style={{ marginLeft: 4 }} title="Allocation entered from the lender statement">Lender split</span>}{p.status === 'reversed' && <div className="tiny neg" title={p.reversalReason}>Reversed: {p.reversalReason}</div>}</td>
                    <td className="nowrap muted">{r ? `#${r.emiNo ?? `M${r.no}`} · due ${fmt.date(r.dueDate)}` : '—'}</td>
                    <td className="num"><Money v={p.amount} /></td>
                    <td className="num">{a && p.status === 'active' ? <Money v={a.principal} /> : '—'}</td>
                    <td className="num">{a && p.status === 'active' ? <Money v={a.interest} /> : '—'}</td>
                    <td className="num">{a && p.status === 'active' ? <Money v={+a.fees + +a.penalty} /> : '—'}{a && +a.unapplied > 0 && <div className="tiny warn">+{fmt.money(a.unapplied)} unapplied</div>}</td>
                    <td className="muted small">{p.reference}{p.notes && <div className="tiny faint" title={p.notes}>{p.notes.slice(0, 40)}</div>}</td>
                    <td className="right nowrap no-print">
                      {p.reconciled && <CheckSquare size={14} className="pos" aria-label="Reconciled" />}
                      {p.attachmentPath && <button className="btn ghost icon sm" title="Open attachment" aria-label="Open attachment" onClick={() => act(() => call('attachment:open', { name: p.attachmentPath }))}><Paperclip size={14} /></button>}
                      {p.status === 'active' && (
                        <>
                          <button className="btn ghost icon sm" title={p.reconciled ? 'Mark not reconciled' : 'Mark reconciled with lender statement'} aria-label="Toggle reconciled" onClick={() => act(() => call('payment:save', { payment: { ...p, reconciled: !p.reconciled } }), p.reconciled ? 'Marked unreconciled' : 'Marked reconciled')}>{p.reconciled ? <Undo2 size={14} /> : <CheckSquare size={14} />}</button>
                          <button className="btn ghost icon sm" title="Edit" aria-label="Edit payment" onClick={() => setEdit(p)}><Edit3 size={14} /></button>
                          <button className="btn ghost icon sm" title="Reverse" aria-label="Reverse payment" onClick={() => setReverse(p)}><Ban size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <PaymentForm initial={edit} onClose={() => setEdit(null)} />}
      {reverse && <ReverseDialog payment={reverse} onClose={() => setReverse(null)} />}
    </Card>
  );
}
