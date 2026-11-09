import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, HandCoins, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { debtStats, debtSummary, type DebtStatus } from '../../shared/debts';
import { blankDebt, blankDebtRepayment } from '../../shared/defaults';
import { debtRepaymentSchema, debtSchema, fieldErrors } from '../../shared/validation';
import type { Debt, DebtRepayment } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useStore } from '../lib/store';
import { BtnGroup, Callout, Card, Check, Confirm, Empty, Modal, MoneyInput, TextInput } from '../components/ui';

const STATUS_LABEL: Record<DebtStatus, string> = { settled: 'Settled', overdue: 'Overdue', due: 'Due today', pending: 'Pending' };
const STATUS_CLASS: Record<DebtStatus, string> = { settled: 's-paid', overdue: 's-overdue', due: 's-partial', pending: '' };
type Filter = 'open' | 'lent' | 'borrowed' | 'settled' | 'all';
interface StatCard { label: string; value: string; tone?: 'pos' | 'neg'; foot?: string }

/** Money lent to and borrowed from people: no interest, just amounts, return dates and repayments. */
export function Lending() {
  const { data, fmt, asOf } = useStore();
  const act = useAction();
  const [edit, setEdit] = useState<Debt | null>(null);
  const [repay, setRepay] = useState<Debt | null>(null);
  const [del, setDel] = useState<Debt | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const rows = useMemo(() => data.debts
    .map((d) => ({ d, s: debtSummary(d, data.debtRepayments, asOf) }))
    .filter(({ d, s }) => filter === 'all' || (filter === 'settled' ? s.status === 'settled' : s.status !== 'settled' && (filter === 'open' || d.direction === filter)))
    .sort((a, b) => Number(a.s.status === 'settled') - Number(b.s.status === 'settled') || (a.d.dueDate ?? '9999').localeCompare(b.d.dueDate ?? '9999') || b.d.date.localeCompare(a.d.date)),
  [data.debts, data.debtRepayments, asOf, filter]);
  // the cards at the top describe exactly the entries listed below
  const st = useMemo(() => debtStats(rows), [rows]);
  const n = (x: { count: number }) => `${x.count} ${x.count === 1 ? 'entry' : 'entries'}`;
  const net = +st.lent.pending - +st.borrowed.pending;
  const netCard: StatCard = { label: 'Net still pending', value: fmt.money(Math.abs(net).toFixed(2)), tone: net >= 0 ? 'pos' : 'neg', foot: net >= 0 ? 'in your favour' : 'you owe overall' };
  const byFilter: Record<Filter, StatCard[]> = {
    open: [
      { label: 'You will get back', value: fmt.money(st.lent.pending), tone: 'pos', foot: `${n(st.lent)} open` },
      { label: 'You owe', value: fmt.money(st.borrowed.pending), tone: 'neg', foot: `${n(st.borrowed)} open` },
      netCard,
    ],
    lent: [
      { label: 'Lent (open entries)', value: fmt.money(st.lent.amount), foot: n(st.lent) },
      { label: 'Got back so far', value: fmt.money(st.lent.repaid), tone: 'pos' },
      { label: 'Still to get back', value: fmt.money(st.lent.pending), tone: 'pos' },
    ],
    borrowed: [
      { label: 'Borrowed (open entries)', value: fmt.money(st.borrowed.amount), foot: n(st.borrowed) },
      { label: 'Paid back so far', value: fmt.money(st.borrowed.repaid) },
      { label: 'Still to pay back', value: fmt.money(st.borrowed.pending), tone: 'neg' },
    ],
    settled: [
      { label: 'Lent and got back in full', value: fmt.money(st.lent.amount), tone: 'pos', foot: n(st.lent) },
      { label: 'Borrowed and paid back in full', value: fmt.money(st.borrowed.amount), foot: n(st.borrowed) },
      { label: 'Total settled', value: fmt.money((+st.lent.amount + +st.borrowed.amount).toFixed(2)), foot: n({ count: st.lent.count + st.borrowed.count }) },
    ],
    all: [
      { label: 'Lent in total', value: fmt.money(st.lent.amount), foot: `got back ${fmt.money(st.lent.repaid)} · ${n(st.lent)}` },
      { label: 'Borrowed in total', value: fmt.money(st.borrowed.amount), foot: `paid back ${fmt.money(st.borrowed.repaid)} · ${n(st.borrowed)}` },
      netCard,
    ],
  };
  const cards = byFilter[filter];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Lending & Borrowing</h1><p className="page-sub">Money you gave to or took from people — what is still to come back and what you still owe. Not part of monthly expenses.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setEdit(blankDebt(asOf, 'borrowed'))}><ArrowDownLeft />I borrowed</button>
          <button className="btn primary" onClick={() => setEdit(blankDebt(asOf, 'lent'))}><ArrowUpRight />I lent</button>
        </div>
      </div>
      {!data.debts.length ? (
        <Card><Empty icon={<HandCoins />} title="Nothing lent or borrowed yet" action={<button className="btn primary" onClick={() => setEdit(blankDebt(asOf, 'lent'))}><Plus />Add an entry</button>}>
          Note down money you lend to friends or family, or borrow from them. Record what comes back (or what you return) bit by bit, and get a reminder on the day it is due.
        </Empty></Card>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <BtnGroup label="Show" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'lent', label: 'Lent' }, { value: 'borrowed', label: 'Borrowed' }, { value: 'settled', label: 'Settled' }, { value: 'all', label: 'All' }]} />
          </div>
          <div className="grid g3" style={{ marginBottom: 14 }} aria-label="Totals for the entries shown">
            {cards.map((c) => (
              <div key={c.label} className="card tight"><div className="stat-label">{c.label}</div><div className={`stat-value ${c.tone ?? ''}`}>{c.value}</div>{c.foot && <div className="tiny faint">{c.foot}</div>}</div>
            ))}
          </div>
          <Card flush>
            {!rows.length ? <div className="small muted" style={{ padding: 16 }}>Nothing here.</div> : (
              <table className="data">
                <thead><tr><th>Person</th><th className="num">Amount</th><th className="num">Returned</th><th className="num">Pending</th><th>Return by</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map(({ d, s }) => [
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === d.id ? null : d.id)}>
                      <td><b>{d.person}</b><div className="tiny faint">{d.direction === 'lent' ? 'You lent' : 'You borrowed'} · {fmt.date(d.date)}{d.notes ? ` · ${d.notes}` : ''}</div></td>
                      <td className="num">{fmt.money(d.amount)}</td>
                      <td className="num">{fmt.money(s.repaid)}</td>
                      <td className={`num ${s.status === 'settled' ? '' : d.direction === 'lent' ? 'pos' : 'neg'}`}><b>{fmt.money(s.pending)}</b></td>
                      <td>{d.dueDate ? fmt.date(d.dueDate) : <span className="faint">—</span>}</td>
                      <td className={STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</td>
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        {s.status !== 'settled' && <button className="btn sm primary" onClick={() => setRepay(d)}><CheckCircle2 size={14} />{d.direction === 'lent' ? 'Got money back' : 'Paid back'}</button>}
                        <button className="btn sm ghost icon" aria-label={`Edit ${d.person}`} onClick={() => setEdit(d)}><Pencil size={14} /></button>
                        <button className="btn sm ghost icon" aria-label={`Delete ${d.person}`} onClick={() => setDel(d)}><Trash2 size={14} /></button>
                      </td>
                    </tr>,
                    open === d.id && (
                      <tr key={`${d.id}-h`}><td colSpan={7} style={{ background: 'var(--surface-2)' }}>
                        {!s.repayments.length ? <span className="small muted">Nothing returned yet.</span> : (
                          <div className="col" style={{ gap: 4 }}>
                            {s.repayments.map((r) => (
                              <div key={r.id} className="row between small">
                                <span>{fmt.date(r.date)}{r.notes ? ` · ${r.notes}` : ''}</span>
                                <span className="row"><b>{fmt.money(r.amount)}</b><button className="btn sm ghost" onClick={() => act(() => call('debtRepayment:delete', { id: r.id }), 'Repayment removed')}><Undo2 size={13} />Undo</button></span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td></tr>
                    ),
                  ])}
                </tbody>
              </table>
            )}
          </Card>
          <div className="tiny faint" style={{ marginTop: 8 }}>Click an entry to see what was returned and when.</div>
        </>
      )}
      {edit && <DebtForm initial={edit} onClose={() => setEdit(null)} />}
      {repay && <RepayDialog debt={repay} onClose={() => setRepay(null)} />}
      {del && (
        <Confirm title={`Delete this entry for ${del.person}?`} danger confirmLabel="Delete" onClose={() => setDel(null)}
          onConfirm={async () => { await act(() => call('debt:delete', { id: del.id }), 'Entry deleted'); setDel(null); }}>
          The entry and everything returned against it are removed from all your synced devices.
        </Confirm>
      )}
    </div>
  );
}

function DebtForm({ initial, onClose }: { initial: Debt; onClose: () => void }) {
  const { data, prefs } = useStore();
  const act = useAction();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Debt>(k: K, v: Debt[K]) => setD((x) => ({ ...x, [k]: v }));
  const editing = data.debts.some((x) => x.id === initial.id);
  const lent = d.direction === 'lent';
  const people = useMemo(() => [...new Set(data.debts.map((x) => x.person))].sort(), [data.debts]);
  const save = async () => {
    const normalized = { ...d, person: d.person.trim(), amount: d.amount ? (+d.amount).toFixed(2) : '', notes: d.notes.trim() };
    const r = debtSchema.safeParse(normalized);
    if (!r.success) { setErrors(fieldErrors(r.error)); return; }
    if (await act(() => call('debt:save', normalized), editing ? 'Saved' : lent ? 'Lending added' : 'Borrowing added') !== undefined) onClose();
  };
  return (
    <Modal title={editing ? `Edit entry for ${initial.person}` : lent ? 'Money I lent' : 'Money I borrowed'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{editing ? 'Save changes' : 'Add'}</button></>}>
      <div style={{ marginBottom: 10 }}>
        <BtnGroup label="Direction" value={d.direction} onChange={(v) => set('direction', v)} options={[{ value: 'lent', label: 'I lent (they owe me)' }, { value: 'borrowed', label: 'I borrowed (I owe them)' }]} />
      </div>
      <div className="form-grid">
        <TextInput label={lent ? 'Lent to' : 'Borrowed from'} value={d.person} onChange={(v) => set('person', v)} error={errors.person} placeholder="Name" autoFocus list="debt-people" />
        <datalist id="debt-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
        <MoneyInput label="Amount" value={d.amount} onChange={(v) => set('amount', v)} error={errors.amount} />
        <TextInput label={lent ? 'Given on' : 'Received on'} type="date" value={d.date} onChange={(v) => set('date', v)} error={errors.date} />
        <TextInput label="Return by (optional)" type="date" value={d.dueDate ?? ''} onChange={(v) => set('dueDate', v || null)} error={errors.dueDate} hint="Leave empty if there is no fixed date" />
        <TextInput label="Notes (optional)" value={d.notes} onChange={(v) => set('notes', v)} className="full" placeholder="e.g. for hospital bills, via UPI" />
      </div>
      {d.dueDate && (
        <div style={{ marginTop: 10 }}>
          <Check checked={d.reminderEnabled} onChange={(v) => set('reminderEnabled', v)} label="Remind me the day before, on the day, and the day after if it is still pending" />
          <div className="tiny faint" style={{ marginTop: 4 }}>At {prefs.reminders.time}, while money is still pending.</div>
        </div>
      )}
    </Modal>
  );
}

function RepayDialog({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const { data, fmt, asOf } = useStore();
  const act = useAction();
  const s = debtSummary(debt, data.debtRepayments, asOf);
  const [r, setR] = useState<DebtRepayment>(() => blankDebtRepayment(debt.id, asOf, s.pending));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lent = debt.direction === 'lent';
  const save = async () => {
    const normalized = { ...r, amount: r.amount ? (+r.amount).toFixed(2) : '' };
    const res = debtRepaymentSchema.safeParse(normalized);
    if (!res.success) { setErrors(fieldErrors(res.error)); return; }
    if (+normalized.amount > +s.pending) { setErrors({ amount: `Only ${fmt.money(s.pending)} is pending` }); return; }
    const full = +normalized.amount === +s.pending;
    if (await act(() => call('debtRepayment:save', normalized), full ? `Settled with ${debt.person}` : 'Recorded') !== undefined) onClose();
  };
  return (
    <Modal title={lent ? `Money back from ${debt.person}` : `Paid back to ${debt.person}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Record</button></>}>
      <Callout>Pending: <b>{fmt.money(s.pending)}</b> of {fmt.money(debt.amount)}. Enter less for a part payment.</Callout>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <MoneyInput label="Amount" value={r.amount} onChange={(v) => setR({ ...r, amount: v })} error={errors.amount} />
        <TextInput label="On" type="date" value={r.date} onChange={(v) => setR({ ...r, date: v })} error={errors.date} />
        <TextInput label="Note (optional)" value={r.notes} onChange={(v) => setR({ ...r, notes: v })} className="full" placeholder="e.g. cash, UPI ref" />
      </div>
    </Modal>
  );
}
