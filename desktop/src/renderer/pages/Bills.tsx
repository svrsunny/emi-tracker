import { useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Receipt, Trash2, Undo2 } from 'lucide-react';
import { billOccurrences, nextBillDue } from '../../shared/bills';
import { addDays } from '../../shared/dates';
import { blankBill, blankBillPayment } from '../../shared/defaults';
import { billPaymentSchema, billSchema, fieldErrors } from '../../shared/validation';
import { BILL_FREQUENCY_MONTHS, type Bill, type BillCategory, type BillFrequency, type BillPayment } from '../../shared/types';
import { call } from '../lib/api';
import { useAction, useStore } from '../lib/store';
import { BtnGroup, Callout, Card, Check, Confirm, Empty, Modal, MoneyInput, Select, Switch, TextInput } from '../components/ui';

export const BILL_CATEGORY_LABEL: Record<BillCategory, string> = {
  rent: 'Rent', electricity: 'Electricity', water: 'Water', gas: 'Gas / LPG', mobile: 'Mobile', internet: 'Internet / broadband', tv: 'TV / DTH',
  insurance: 'Insurance', subscription: 'Subscription', education: 'School / tuition fees', maintenance: 'Maintenance / society', credit_card: 'Credit card', other: 'Other',
};
export const BILL_FREQUENCY_LABEL: Record<BillFrequency, string> = {
  monthly: 'Every month', bimonthly: 'Every 2 months', quarterly: 'Every 3 months', half_yearly: 'Every 6 months', yearly: 'Every year', once: 'Only once',
};
const OFFSET_CHOICES = [1, 2, 3, 5, 7];

export function Bills() {
  const { data, fmt, asOf } = useStore();
  const act = useAction();
  const [edit, setEdit] = useState<Bill | null>(null);
  const [pay, setPay] = useState<{ bill: Bill; dueDate?: string } | null>(null);
  const [del, setDel] = useState<Bill | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const recurring = data.bills.filter((b) => b.frequency !== 'once');
  const oneTime = data.bills.filter((b) => b.frequency === 'once').sort((x, y) => y.startDate.localeCompare(x.startDate));
  const active = recurring.filter((b) => b.active);
  // what all active recurring bills cost per month on average
  const monthly = useMemo(() => active.reduce((s, b) => s + +b.amount / BILL_FREQUENCY_MONTHS[b.frequency], 0), [active]);
  const row = (b: Bill) => {
    const next = nextBillDue(b, data.billPayments, asOf);
    const history = data.billPayments.filter((p) => p.billId === b.id).sort((x, y) => y.dueDate.localeCompare(x.dueDate));
    const once = b.frequency === 'once';
    return [
      <tr key={b.id} style={{ cursor: 'pointer', opacity: b.active ? 1 : 0.55 }} onClick={() => setOpen(open === b.id ? null : b.id)}>
        <td><b>{b.name}</b><div className="tiny faint">{BILL_CATEGORY_LABEL[b.category]}{b.payee ? ` · ${b.payee}` : ''}{b.active ? '' : ' · paused'}</div></td>
        <td className="num">{b.variable && <span className="faint">≈ </span>}{fmt.money(once && history[0] ? history[0].amount : b.amount)}</td>
        <td className="muted">{once ? fmt.date(b.startDate) : `${BILL_FREQUENCY_LABEL[b.frequency]} · day ${b.dueDay}`}</td>
        <td>{next ? <span className={next.overdue ? 'neg' : ''}>{fmt.date(next.dueDate)}{next.overdue ? ' · unpaid' : ''}</span> : <span className="faint">{once && history.length ? 'Paid' : '—'}</span>}</td>
        <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
          {b.active && next && <button className="btn sm primary" onClick={() => setPay({ bill: b, dueDate: next.dueDate })}><CheckCircle2 size={14} />Mark paid</button>}
          <button className="btn sm ghost icon" aria-label={`Edit ${b.name}`} onClick={() => setEdit(b)}><Pencil size={14} /></button>
          <button className="btn sm ghost icon" aria-label={`Delete ${b.name}`} onClick={() => setDel(b)}><Trash2 size={14} /></button>
        </td>
      </tr>,
      open === b.id && (
        <tr key={`${b.id}-h`}><td colSpan={5} style={{ background: 'var(--surface-2)' }}>
          {!history.length ? <span className="small muted">No payments recorded yet.</span> : (
            <div className="col" style={{ gap: 4 }}>
              {history.slice(0, 24).map((p) => (
                <div key={p.id} className="row between small">
                  <span>Due {fmt.date(p.dueDate)} · paid {fmt.date(p.paidDate)}{p.notes ? ` · ${p.notes}` : ''}</span>
                  <span className="row"><b>{fmt.money(p.amount)}</b><button className="btn sm ghost" onClick={() => act(() => call('billPayment:delete', { id: p.id }), 'Marked unpaid')}><Undo2 size={13} />Undo</button></span>
                </div>
              ))}
            </div>
          )}
        </td></tr>
      ),
    ];
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Bills</h1><p className="page-sub">Recurring bills — rent, electricity, phone, insurance… — and one-time expenses, with reminders. They count towards your monthly expenses.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setEdit({ ...blankBill(asOf), frequency: 'once', category: 'other' })}><Plus />One-time expense</button>
          <button className="btn primary" onClick={() => setEdit(blankBill(asOf))}><Plus />Add bill</button>
        </div>
      </div>
      {!data.bills.length ? (
        <Card><Empty icon={<Receipt />} title="No bills yet" action={<button className="btn primary" onClick={() => setEdit(blankBill(asOf))}><Plus />Add your first bill</button>}>
          Add the bills you pay every month (or every few months), or a one-time expense. You'll get reminders before they are due, and they show up in Monthly expenses next to your EMIs and chits.
        </Empty></Card>
      ) : (
        <>
          <div className="grid g3" style={{ marginBottom: 14 }}>
            <div className="card tight"><div className="stat-label">Active bills</div><div className="stat-value">{active.length}</div></div>
            <div className="card tight"><div className="stat-label">Average per month</div><div className="stat-value">{fmt.money(monthly.toFixed(2))}</div></div>
            <div className="card tight"><div className="stat-label">Unpaid now</div><div className="stat-value">{active.filter((b) => nextBillDue(b, data.billPayments, asOf)?.overdue).length}</div></div>
          </div>
          {!!recurring.length && (
            <Card flush>
              <table className="data">
                <thead><tr><th>Bill</th><th className="num">Amount</th><th>Repeats</th><th>Next due</th><th /></tr></thead>
                <tbody>{recurring.map(row)}</tbody>
              </table>
            </Card>
          )}
          {!!oneTime.length && (
            <div style={{ marginTop: 14 }}><Card flush title="One-time expenses">
              <table className="data">
                <thead><tr><th>Expense</th><th className="num">Amount</th><th>Date</th><th>Status</th><th /></tr></thead>
                <tbody>{oneTime.map(row)}</tbody>
              </table>
            </Card></div>
          )}
          <div className="tiny faint" style={{ marginTop: 8 }}>Click a bill to see its payment history.</div>
        </>
      )}
      {edit && <BillForm initial={edit} onClose={() => setEdit(null)} />}
      {pay && <BillPayDialog bill={pay.bill} dueDate={pay.dueDate} onClose={() => setPay(null)} />}
      {del && (
        <Confirm title={`Delete ${del.name}?`} danger confirmLabel="Delete bill" onClose={() => setDel(null)}
          onConfirm={async () => { await act(() => call('bill:delete', { id: del.id }), 'Bill deleted'); setDel(null); }}>
          The bill and its payment history are removed from all your synced devices. To stop it for now, edit it and turn off “Active” instead.
        </Confirm>
      )}
    </div>
  );
}

export function BillForm({ initial, onClose }: { initial: Bill; onClose: () => void }) {
  const { data, prefs, asOf } = useStore();
  const act = useAction();
  const [b, setB] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Bill>(k: K, v: Bill[K]) => setB((x) => ({ ...x, [k]: v }));
  const offsets = b.reminderOffsets ?? prefs.reminders.offsets;
  const editing = data.bills.some((x) => x.id === initial.id);
  const once = b.frequency === 'once';
  // a one-time expense on or before today is usually already paid: record it in the same step
  const [alreadyPaid, setAlreadyPaid] = useState(true);
  const askPaid = once && !editing && b.startDate <= asOf;
  const save = async () => {
    const normalized = { ...b, amount: b.amount ? (+b.amount).toFixed(2) : '', name: b.name.trim(), ...(once ? { endDate: null, variable: false, dueDay: +b.startDate.slice(8) || 1 } : {}) };
    const r = billSchema.safeParse(normalized);
    if (!r.success) { setErrors(fieldErrors(r.error)); return; }
    const paid = askPaid && alreadyPaid;
    const ok = await act(async () => {
      await call('bill:save', normalized);
      if (paid) await call('billPayment:save', blankBillPayment(normalized.id, normalized.startDate, normalized.startDate, normalized.amount));
      return true;
    }, editing ? 'Saved' : once ? (paid ? 'Expense added as paid' : 'Expense added') : 'Bill added');
    if (ok !== undefined) onClose();
  };
  return (
    <Modal title={editing ? `Edit ${initial.name}` : once ? 'Add a one-time expense' : 'Add a bill'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{editing ? 'Save changes' : 'Add bill'}</button></>}>
      <div className="form-grid">
        <TextInput label={once ? 'What for' : 'Bill name'} value={b.name} onChange={(v) => set('name', v)} error={errors.name} placeholder={once ? 'e.g. Car service, Gift' : 'e.g. House rent, Electricity'} autoFocus />
        <Select label="Category" value={b.category} onChange={(v) => set('category', v)} options={Object.entries(BILL_CATEGORY_LABEL).map(([value, label]) => ({ value: value as BillCategory, label }))} />
        <MoneyInput label="Amount" value={b.amount} onChange={(v) => set('amount', v)} error={errors.amount} hint={b.variable ? 'Your usual amount; enter the actual one when you pay' : undefined} />
        <TextInput label="Paid to (optional)" value={b.payee} onChange={(v) => set('payee', v)} placeholder="e.g. TSSPDCL, landlord" />
        {!once && <div className="field full"><Check checked={b.variable} onChange={(v) => set('variable', v)} label="The amount changes every time (electricity, water…)" /></div>}
        <Select label="Repeats" value={b.frequency} onChange={(v) => set('frequency', v)} options={Object.entries(BILL_FREQUENCY_LABEL).map(([value, label]) => ({ value: value as BillFrequency, label }))} />
        <TextInput label={once ? 'Date' : 'First due date'} type="date" value={b.startDate} onChange={(v) => { set('startDate', v); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set('dueDay', +v.slice(8)); }} error={errors.startDate} />
        {!once && <TextInput label="Due day of month" type="number" min={1} max={31} value={b.dueDay} onChange={(v) => set('dueDay', Math.max(1, Math.min(31, +v || 1)))} error={errors.dueDay} hint="31 means the last day of shorter months" />}
        {!once && <TextInput label="Last due date (optional)" type="date" value={b.endDate ?? ''} onChange={(v) => set('endDate', v || null)} error={errors.endDate} hint="Leave empty if it keeps going" />}
        {askPaid && <div className="field full"><Check checked={alreadyPaid} onChange={setAlreadyPaid} label="Already paid" /></div>}
      </div>
      <div className="divider" />
      {!(askPaid && alreadyPaid) && <><div className="row between wrap">
        <b>Remind me about this {once ? 'expense' : 'bill'}?</b>
        <BtnGroup label="Bill reminders" value={b.reminderEnabled ? 'yes' : 'no'} onChange={(v) => set('reminderEnabled', v === 'yes')} options={[{ value: 'yes', label: 'Yes, remind me' }, { value: 'no', label: 'No reminders' }]} />
      </div>
      {b.reminderEnabled && (
        <div style={{ marginTop: 8 }}>
          <div className="row wrap">{OFFSET_CHOICES.map((d) => <Check key={d} checked={offsets.includes(d)} label={`${d} day${d === 1 ? '' : 's'} before`}
            onChange={() => set('reminderOffsets', (offsets.includes(d) ? offsets.filter((x) => x !== d) : [...offsets, d]).sort((x, y) => y - x))} />)}</div>
          <div className="tiny faint" style={{ marginTop: 4 }}>Also on the due day at {prefs.reminders.time}, and the day after if it is still unpaid.</div>
        </div>
      )}
      <div className="divider" /></>}
      <TextInput label="Notes (optional)" value={b.notes} onChange={(v) => set('notes', v)} className="full" />
      {editing && <div style={{ marginTop: 8 }}><Switch checked={b.active} onChange={(v) => set('active', v)} label="Active" hint="Turn off to pause a bill without deleting its history" /></div>}
    </Modal>
  );
}

/** Mark a bill paid for one due date (unpaid ones from the last 3 months, the next one, or any later one). */
export function BillPayDialog({ bill, dueDate, onClose }: { bill: Bill; dueDate?: string; onClose: () => void }) {
  const { data, fmt, asOf } = useStore();
  const act = useAction();
  const options = useMemo(() => billOccurrences([bill], data.billPayments, addDays(asOf, -100), addDays(asOf, 370), asOf).filter((o) => !o.payment).slice(0, 8), [bill, data.billPayments, asOf]);
  const [p, setP] = useState<BillPayment>(() => blankBillPayment(bill.id, dueDate ?? options[0]?.dueDate ?? asOf, asOf, bill.variable ? '' : bill.amount));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async () => {
    const normalized = { ...p, amount: p.amount ? (+p.amount).toFixed(2) : '' };
    const r = billPaymentSchema.safeParse(normalized);
    if (!r.success || !normalized.amount) { setErrors(r.success ? { amount: 'Enter the amount you paid' } : fieldErrors(r.error)); return; }
    if (await act(() => call('billPayment:save', normalized), `${bill.name} marked paid`) !== undefined) onClose();
  };
  return (
    <Modal title={`Mark ${bill.name} paid`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Mark paid</button></>}>
      <div className="form-grid">
        <Select label="For the bill due on" value={p.dueDate} onChange={(v) => setP({ ...p, dueDate: v })}
          options={(options.some((o) => o.dueDate === p.dueDate) ? options : [{ dueDate: p.dueDate }, ...options]).map((o) => ({ value: o.dueDate, label: fmt.date(o.dueDate) }))} />
        <MoneyInput label="Amount paid" value={p.amount} onChange={(v) => setP({ ...p, amount: v })} error={errors.amount} hint={bill.variable ? `Usually about ${fmt.money(bill.amount)}` : undefined} />
        <TextInput label="Paid on" type="date" value={p.paidDate} onChange={(v) => setP({ ...p, paidDate: v })} error={errors.paidDate} />
        <TextInput label="Note (optional)" value={p.notes} onChange={(v) => setP({ ...p, notes: v })} placeholder="e.g. UPI ref" />
      </div>
      {!options.length && <Callout>Nothing is due for this bill in the coming year.</Callout>}
    </Modal>
  );
}
