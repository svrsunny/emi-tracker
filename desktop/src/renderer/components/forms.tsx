import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Paperclip } from 'lucide-react';
import { blankAdjustment, blankLoan, blankPayment } from '../../shared/defaults';
import { calculateEmi, computeLoan, dueDateFor, OPEN_STATUSES } from '../../shared/engine';
import { addDays, diffDays, isValidISODate, parts } from '../../shared/dates';
import { fieldErrors, adjustmentSchema, loanSchema, paymentSchema } from '../../shared/validation';
import type { Adjustment, Loan, Payment, PaymentType } from '../../shared/types';
import { ApiError, call } from '../lib/api';
import { useStore } from '../lib/store';
import {
  BtnGroup, Callout, Check, Confirm, Estimate, Kv, LOAN_TYPE_LABEL, Modal, MoneyInput, PAYMENT_TYPE_LABEL, Select, Status, Switch, TextInput,
} from './ui';

const money2 = (s: string | null | undefined) => (s === null || s === undefined || s === '' ? s ?? null : (+s).toFixed(2));

const FREQ = [
  { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'half_yearly', label: 'Half-yearly' },
  { value: 'yearly', label: 'Yearly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'weekly', label: 'Weekly' },
] as const;

const STEPS = ['Basics', 'Amount & rate', 'Schedule', 'Charges & rules', 'History', 'Reminders', 'Review'];
const REVIEW = STEPS.length - 1;
const OFFSET_CHOICES = [1, 2, 3, 5, 7, 10, 15];

/** Loan creation wizard; also used to edit every field of an existing loan. */
export function LoanWizard({ initial, onClose, onSaved }: { initial?: Loan; onClose: () => void; onSaved?: (l: Loan) => void }) {
  const { asOf, data, fmt, prefs, reload, toast } = useStore();
  const editing = !!initial;
  const [l, setL] = useState<Loan>(() => initial ?? blankLoan(asOf, data.loans.length));
  const [step, setStep] = useState(editing ? REVIEW : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emiMode, setEmiMode] = useState<'auto' | 'manual'>(initial?.emiAmount ? 'manual' : 'auto');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Loan>(k: K, v: Loan[K]) => setL((x) => ({ ...x, [k]: v }));
  const chit = l.loanType === 'chit_fund';
  /** Chit value or installment changed: suggest the number of months (value ÷ installment). */
  const setChitAmount = (k: 'principal' | 'emiAmount', v: string) => setL((x) => {
    const next = { ...x, [k]: v };
    const value = +next.principal, inst = +(next.emiAmount ?? 0);
    return value > 0 && inst > 0 ? { ...next, totalInstallments: Math.max(1, Math.ceil(value / inst - 1e-9)) } : next;
  });

  const normalized = (): Loan => chit ? {
    // a chit fund has no interest: the installment is entered, nothing is calculated
    ...l, principal: money2(l.principal) ?? '', sanctionedAmount: money2(l.principal) ?? '', disbursedAmount: money2(l.principal) ?? '',
    annualRate: '0', rateType: 'fixed', interestMethod: 'flat', emiAmount: money2(l.emiAmount), emiRounding: 'paisa', frequency: 'monthly',
    startDate: l.firstEmiDate, sanctionDate: null, moratoriumPeriods: 0, preEmiInterest: '0.00', processingFee: '0.00', otherCharges: '0.00',
    lateFee: money2(l.lateFee || '0') ?? '0.00', penalRate: '0', advanceEmiBalance: '0.00', prepaymentEffect: 'reduce_tenure',
    openingOutstanding: l.openingOutstanding ? money2(l.openingOutstanding) : null, lenderOutstanding: null, lenderOutstandingDate: null,
  } : ({
    ...l,
    principal: money2(l.principal) ?? '',
    sanctionedAmount: money2(l.sanctionedAmount || l.principal) ?? '',
    disbursedAmount: money2(l.disbursedAmount || l.principal) ?? '',
    emiAmount: emiMode === 'manual' ? money2(l.emiAmount) : null,
    preEmiInterest: money2(l.preEmiInterest || '0') ?? '0.00', processingFee: money2(l.processingFee || '0') ?? '0.00',
    otherCharges: money2(l.otherCharges || '0') ?? '0.00', lateFee: money2(l.lateFee || '0') ?? '0.00',
    advanceEmiBalance: money2(l.advanceEmiBalance || '0') ?? '0.00', penalRate: l.penalRate || '0',
    openingOutstanding: l.openingOutstanding ? money2(l.openingOutstanding) : null,
    lenderOutstanding: l.lenderOutstanding ? money2(l.lenderOutstanding) : null,
    lenderOutstandingDate: l.lenderOutstanding ? l.lenderOutstandingDate : null,
  });

  const autoEmi = useMemo(() => {
    const p = +l.principal, r = +l.annualRate;
    if (!(p > 0) || !(r >= 0) || !(l.totalInstallments > 0)) return null;
    return calculateEmi(String(p), String(r), l.totalInstallments, l.frequency, l.interestMethod, l.emiRounding);
  }, [l.principal, l.annualRate, l.totalInstallments, l.frequency, l.interestMethod, l.emiRounding]);

  const preview = useMemo(() => {
    const n = normalized();
    const r = loanSchema.safeParse(n);
    if (!r.success) return null;
    return computeLoan(n, data.adjustments.filter((a) => a.loanId === n.id), data.payments.filter((p) => p.loanId === n.id), asOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l, emiMode, asOf]);

  const pastDue = useMemo(() => {
    if (!isValidISODate(l.firstEmiDate)) return 0;
    let n = 0;
    for (let i = 0; i < l.moratoriumPeriods + l.totalInstallments && i < 1500; i++) {
      if (dueDateFor(l, i) < asOf) n++; else break;
    }
    return Math.max(0, n - l.moratoriumPeriods);
  }, [l, asOf]);

  const validateStep = (s: number): boolean => {
    const r = loanSchema.safeParse(normalized());
    const all = r.success ? {} : fieldErrors(r.error);
    const fields: Record<number, string[]> = {
      0: ['name', 'category', 'lender', 'accountRef'],
      1: ['principal', 'sanctionedAmount', 'disbursedAmount', 'annualRate', 'emiAmount'],
      2: ['startDate', 'firstEmiDate', 'emiDueDay', 'totalInstallments', 'sanctionDate', 'moratoriumPeriods'],
      3: ['processingFee', 'otherCharges', 'preEmiInterest', 'lateFee', 'penalRate', 'gracePeriodDays', 'advanceEmiBalance'],
      4: ['installmentsPaidBeforeTracking', 'openingOutstanding', 'trackingStartDate', 'lenderOutstanding', 'lenderOutstandingDate'],
      5: ['reminderOffsets', 'firstEmiDate', 'emiDueDay'],
      6: Object.keys(all),
    };
    const relevant = Object.fromEntries(Object.entries(all).filter(([k]) => fields[s].includes(k) || s === REVIEW));
    if (s === 1 && (emiMode === 'manual' || chit) && !(+(l.emiAmount ?? 0) > 0)) relevant.emiAmount = chit ? 'Enter the monthly installment' : 'Enter the EMI from your loan statement, or choose “Calculate”';
    setErrors(relevant);
    return Object.keys(relevant).length === 0;
  };

  const next = () => { if (validateStep(step)) setStep((s) => Math.min(REVIEW, s + 1)); };
  const save = async () => {
    if (!validateStep(REVIEW)) return;
    setBusy(true);
    try {
      const saved = await call<Loan>('loan:save', normalized());
      await reload();
      toast({ kind: 'success', title: editing ? 'Loan updated' : 'Loan created', body: saved.name });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save loan', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const e = errors;
  return (
    <Modal size="wide" title={editing ? `Edit ${initial!.name}` : 'Add a loan'} sub={editing ? 'Every field can be changed. Payment history is preserved.' : 'A few short steps. You can edit everything later.'} onClose={onClose}
      footer={<>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        {step < REVIEW ? <button className="btn primary" onClick={next}>Continue</button> : <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create loan'}</button>}
      </>}>
      <div className="steps" role="list">
        {STEPS.map((s, i) => (
          <button key={s} role="listitem" className={`step ${i < step ? 'done' : ''} ${i === step ? 'on' : ''}`} style={{ border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
            onClick={() => (i < step || editing ? setStep(i) : validateStep(step) && setStep(i))} aria-current={i === step ? 'step' : undefined}>
            <i />{chit && s === 'Amount & rate' ? 'Amount' : s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="form-grid">
          <TextInput label="Loan name" value={l.name} onChange={(v) => set('name', v)} error={e.name} placeholder="e.g. Home loan — HDFC" autoFocus />
          <Select label="Loan type" value={l.loanType} onChange={(v) => { set('loanType', v); if (v === 'chit_fund') { setEmiMode('manual'); if (!l.category || l.category === blankLoan(asOf, 0).category) set('category', 'Chit fund'); } }} options={Object.entries(LOAN_TYPE_LABEL).map(([value, label]) => ({ value: value as Loan['loanType'], label }))} />
          <TextInput label="Category" value={l.category} onChange={(v) => set('category', v)} hint="Free text, e.g. Home, Vehicle, Family" error={e.category} />
          <TextInput label={chit ? 'Foreman / organiser' : 'Lender / bank'} value={l.lender} onChange={(v) => set('lender', v)} error={e.lender} />
          <TextInput label="Loan account reference (optional)" value={l.accountRef} onChange={(v) => set('accountRef', v)} hint="Stored locally only" error={e.accountRef} />
          <div className="field"><span className="field-label">Display</span><Check checked={l.maskAccountRef} onChange={(v) => set('maskAccountRef', v)} label="Mask account reference (show last 4 digits)" /></div>
          <Select label="Loan status" value={l.status} onChange={(v) => set('status', v)} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }, { value: 'foreclosed', label: 'Foreclosed' }, { value: 'archived', label: 'Archived' }]} />
          <div className="field"><span className="field-label">Colour</span><input type="color" className="input" value={l.color} onChange={(ev) => set('color', ev.target.value)} style={{ padding: 2, width: 64 }} aria-label="Loan colour" /></div>
        </div>
      )}

      {step === 1 && chit && (
        <div className="col">
          <div className="form-grid">
            <MoneyInput label="Chit value" value={l.principal} onChange={(v) => setChitAmount('principal', v)} error={e.principal} hint="The total amount of the chit, e.g. 1,00,000" />
            <MoneyInput label="Monthly installment" value={l.emiAmount} onChange={(v) => setChitAmount('emiAmount', v)} error={e.emiAmount} hint="The full installment, before any dividend" />
          </div>
          <Callout>No interest is needed for a chit fund. Each month you record what you actually paid; if it is less than the full installment, the difference is counted as your dividend.</Callout>
        </div>
      )}

      {step === 1 && !chit && (
        <div className="col">
          <div className="form-grid">
            <MoneyInput label="Original principal" value={l.principal} onChange={(v) => set('principal', v)} error={e.principal} hint="The amount your EMI schedule is based on" />
            <MoneyInput label="Sanctioned amount" value={l.sanctionedAmount} onChange={(v) => set('sanctionedAmount', v)} error={e.sanctionedAmount} hint="Defaults to the principal" />
            <MoneyInput label="Amount actually disbursed" value={l.disbursedAmount} onChange={(v) => set('disbursedAmount', v)} error={e.disbursedAmount} hint="Defaults to the principal" />
            <TextInput label="Annual interest rate" value={l.annualRate} onChange={(v) => set('annualRate', v.replace(/[^\d.]/g, ''))} suffix="%" error={e.annualRate} />
            <Select label="Rate type" value={l.rateType} onChange={(v) => set('rateType', v)} options={[{ value: 'floating', label: 'Floating' }, { value: 'fixed', label: 'Fixed' }]} hint="Record rate revisions on the loan page" />
            <Select label="Interest calculation" value={l.interestMethod} onChange={(v) => set('interestMethod', v)} options={[
              { value: 'reducing_monthly', label: 'Reducing balance — monthly rest (standard)' },
              { value: 'reducing_daily', label: 'Reducing balance — daily (actual/365)' },
              { value: 'flat', label: 'Flat rate on original principal' },
            ]} />
          </div>
          <div className="card tight" style={{ background: 'var(--surface-2)' }}>
            <div className="row between wrap">
              <div className="col" style={{ gap: 4 }}>
                <span className="field-label">EMI amount</span>
                <div className="btn-group">
                  <button className={emiMode === 'auto' ? 'on' : ''} onClick={() => setEmiMode('auto')}>Calculate</button>
                  <button className={emiMode === 'manual' ? 'on' : ''} onClick={() => { setEmiMode('manual'); if (!l.emiAmount && autoEmi) set('emiAmount', autoEmi); }}>Enter from lender</button>
                </div>
              </div>
              {emiMode === 'auto'
                ? <div className="right"><div className="stat-value">{autoEmi ? fmt.money(autoEmi) : '—'}</div><div className="small faint">Calculated · <Estimate label="estimate until confirmed" /></div></div>
                : <div style={{ width: 220 }}><MoneyInput label="EMI per installment" value={l.emiAmount} onChange={(v) => set('emiAmount', v)} error={e.emiAmount} /></div>}
              <Select label="EMI rounding" value={l.emiRounding} onChange={(v) => set('emiRounding', v)} options={[{ value: 'rupee_nearest', label: 'Nearest rupee' }, { value: 'rupee_up', label: 'Round up to rupee' }, { value: 'paisa', label: 'Exact to paisa' }]} />
            </div>
            {emiMode === 'manual' && autoEmi && l.emiAmount && Math.abs(+l.emiAmount - +autoEmi) > 1 && (
              <div style={{ marginTop: 10 }}><Callout kind="warn">Your EMI differs from the calculated {fmt.money(autoEmi)}. That's normal if the lender uses a different method; the schedule will follow your EMI.</Callout></div>
            )}
          </div>
        </div>
      )}

      {step === 2 && chit && (
        <div className="form-grid">
          <TextInput label="First installment date" type="date" value={l.firstEmiDate} onChange={(v) => { set('firstEmiDate', v); if (isValidISODate(v)) set('emiDueDay', parts(v)[2]); }} error={e.firstEmiDate} />
          <TextInput label="Installment day of month" type="number" min={1} max={31} value={l.emiDueDay} onChange={(v) => set('emiDueDay', +v || 1)} error={e.emiDueDay} hint="31 means the last day of shorter months" />
          <TextInput label="Number of months" type="number" min={1} value={l.totalInstallments} onChange={(v) => set('totalInstallments', Math.max(0, Math.floor(+v || 0)))} error={e.totalInstallments}
            hint={+l.principal > 0 && +(l.emiAmount ?? 0) > 0 ? `Chit value ÷ installment = ${Math.ceil(+l.principal / +(l.emiAmount ?? 1) - 1e-9)} months` : 'How many installments the chit runs for'} />
        </div>
      )}

      {step === 2 && !chit && (
        <div className="form-grid">
          <TextInput label="Sanction date" type="date" value={l.sanctionDate ?? ''} onChange={(v) => set('sanctionDate', v || null)} error={e.sanctionDate} />
          <TextInput label="Loan start / disbursement date" type="date" value={l.startDate} onChange={(v) => set('startDate', v)} error={e.startDate} hint="Interest starts accruing from this date" />
          <TextInput label="First EMI date" type="date" value={l.firstEmiDate} onChange={(v) => { set('firstEmiDate', v); if (isValidISODate(v)) set('emiDueDay', parts(v)[2]); }} error={e.firstEmiDate} />
          <TextInput label="EMI due day of month" type="number" min={1} max={31} value={l.emiDueDay} onChange={(v) => set('emiDueDay', +v || 1)} error={e.emiDueDay} hint="31 means the last day of shorter months" />
          <Select label="Repayment frequency" value={l.frequency} onChange={(v) => set('frequency', v)} options={FREQ.map((f) => ({ ...f }))} />
          <TextInput label="Total EMI installments" type="number" min={1} value={l.totalInstallments} onChange={(v) => set('totalInstallments', Math.max(0, Math.floor(+v || 0)))} error={e.totalInstallments}
            hint={l.frequency === 'monthly' ? `${(l.totalInstallments / 12).toFixed(1)} years` : 'Excludes moratorium periods'} />
          <TextInput label="Moratorium periods" type="number" min={0} value={l.moratoriumPeriods} onChange={(v) => set('moratoriumPeriods', Math.max(0, Math.floor(+v || 0)))} error={e.moratoriumPeriods} hint="Installment periods before EMIs start" />
          <Select label="During moratorium" value={l.moratoriumTreatment} onChange={(v) => set('moratoriumTreatment', v)} options={[{ value: 'capitalize', label: 'Interest added to principal' }, { value: 'interest_only', label: 'Pay interest only (pre-EMI)' }]} />
        </div>
      )}

      {step === 3 && chit && (
        <div className="col">
          <Callout>Chit funds have no processing fees or interest. Add a late fee only if your foreman charges one.</Callout>
          <div className="form-grid">
            <MoneyInput label="Late payment fee (per late installment)" value={l.lateFee} onChange={(v) => set('lateFee', v)} error={e.lateFee} />
            <TextInput label="Grace period" type="number" min={0} value={l.gracePeriodDays} onChange={(v) => set('gracePeriodDays', Math.max(0, Math.floor(+v || 0)))} suffix="days" error={e.gracePeriodDays} />
          </div>
        </div>
      )}

      {step === 3 && !chit && (
        <div className="form-grid">
          <MoneyInput label="Processing fee paid" value={l.processingFee} onChange={(v) => set('processingFee', v)} error={e.processingFee} />
          <MoneyInput label="Other upfront charges" value={l.otherCharges} onChange={(v) => set('otherCharges', v)} error={e.otherCharges} hint="Insurance, stamp duty, legal…" />
          <MoneyInput label="Pre-EMI / broken-period interest paid" value={l.preEmiInterest} onChange={(v) => set('preEmiInterest', v)} error={e.preEmiInterest} />
          <MoneyInput label="Late payment fee (per late EMI)" value={l.lateFee} onChange={(v) => set('lateFee', v)} error={e.lateFee} hint="Used to estimate charges on late EMIs" />
          <TextInput label="Penal interest on overdue amount" value={l.penalRate} onChange={(v) => set('penalRate', v.replace(/[^\d.]/g, ''))} suffix="%" error={e.penalRate} hint="% per annum; 0 to disable" />
          <TextInput label="Grace period" type="number" min={0} value={l.gracePeriodDays} onChange={(v) => set('gracePeriodDays', Math.max(0, Math.floor(+v || 0)))} suffix="days" error={e.gracePeriodDays} />
          <MoneyInput label="Advance EMI balance with lender" value={l.advanceEmiBalance} onChange={(v) => set('advanceEmiBalance', v)} error={e.advanceEmiBalance} hint="Reduces the foreclosure estimate" />
          <Select label="When you prepay" value={l.prepaymentEffect} onChange={(v) => set('prepaymentEffect', v)} options={[{ value: 'reduce_tenure', label: 'Keep EMI, reduce tenure' }, { value: 'reduce_emi', label: 'Keep tenure, reduce EMI' }]} />
          <Select label="Payment allocation order" value={l.allocationOrder} onChange={(v) => set('allocationOrder', v)} options={[{ value: 'interest_principal_fees', label: 'Interest → principal → charges' }, { value: 'fees_interest_principal', label: 'Charges → interest → principal' }]} hint="How your lender applies each EMI" />
        </div>
      )}

      {step === 4 && (
        <div className="col">
          {pastDue > 0 && !editing && (
            <Callout kind="info">
              {pastDue} EMI(s) were due before today. If you already paid them but don't want to enter each one, mark them as paid before tracking — they'll be shown as <b>assumed paid</b> and labelled as estimates.
              <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => { set('installmentsPaidBeforeTracking', pastDue); set('trackingStartDate', asOf); }}>Assume {pastDue} EMI(s) were paid</button></div>
            </Callout>
          )}
          <div className="form-grid">
            <TextInput label="Installments paid before tracking" type="number" min={0} value={l.installmentsPaidBeforeTracking} onChange={(v) => set('installmentsPaidBeforeTracking', Math.max(0, Math.floor(+v || 0)))} error={e.installmentsPaidBeforeTracking} hint="Assumed paid on schedule; shown as estimates" />
            <MoneyInput label="Outstanding principal after those (optional)" value={l.openingOutstanding} onChange={(v) => set('openingOutstanding', v || null)} error={e.openingOutstanding} hint="From the lender's statement; overrides the calculated balance" />
            <TextInput label="Tracking start date" type="date" value={l.trackingStartDate} onChange={(v) => set('trackingStartDate', v)} error={e.trackingStartDate} hint="Before this date, missing records are shown as ‘no data’, not missed" />
            <MoneyInput label="Lender's current outstanding (optional)" value={l.lenderOutstanding} onChange={(v) => { set('lenderOutstanding', v || null); if (v && !l.lenderOutstandingDate) set('lenderOutstandingDate', asOf); }} error={e.lenderOutstanding} hint="For reconciliation only — never assumed to be principal" />
            <TextInput label="As of date" type="date" value={l.lenderOutstandingDate ?? ''} onChange={(v) => set('lenderOutstandingDate', v || null)} error={e.lenderOutstandingDate} />
          </div>
          <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" className="input" value={l.notes} onChange={(ev) => set('notes', ev.target.value)} maxLength={4000} /></div>
        </div>
      )}

      {step === 5 && (
        <ReminderStep loan={l} set={set} errors={e} upcoming={preview ? preview.rows.filter((r) => r.dueDate >= asOf && OPEN_STATUSES.includes(r.status)).slice(0, 3).map((r) => r.dueDate) : []} />
      )}

      {step === REVIEW && (
        <div className="col">
          {Object.keys(errors).length > 0 && <Callout kind="danger">Please fix: {Object.values(errors).slice(0, 3).join(' · ')}</Callout>}
          <div className="grid g2">
            <div className="card tight">
              <h3 className="section-title" style={{ marginBottom: 8 }}>{l.name || 'Unnamed loan'}</h3>
              <Kv items={[
                [chit ? 'Foreman' : 'Lender', l.lender || '—'], ['Type', LOAN_TYPE_LABEL[l.loanType]], [chit ? 'Chit value' : 'Principal', fmt.money(l.principal || 0)],
                ...(chit ? [['Monthly installment', fmt.money(l.emiAmount)]] as [string, ReactNode][] : [['Rate', `${l.annualRate || 0}% ${l.rateType} · ${l.interestMethod.replace('_', ' ')}`], ['EMI', emiMode === 'manual' ? fmt.money(l.emiAmount) : <>{fmt.money(autoEmi)} <Estimate /></>]] as [string, ReactNode][]),
                ['Installments', `${l.totalInstallments} × ${l.frequency.replace('_', '-')}`], [chit ? 'First installment' : 'First EMI', fmt.date(l.firstEmiDate)],
                ['Moratorium', l.moratoriumPeriods ? `${l.moratoriumPeriods} (${l.moratoriumTreatment === 'capitalize' ? 'capitalised' : 'interest only'})` : 'None'],
                ['Reminders', l.reminderEnabled ? `${(l.reminderOffsets ?? prefs.reminders.offsets).join(', ')} day(s) before and on the due date` : 'Off'],
              ]} />
            </div>
            <div className="card tight">
              <h3 className="section-title" style={{ marginBottom: 8 }}>Calculated preview</h3>
              {preview ? (
                <Kv items={[
                  ...(chit ? [] : [['Total interest (contract)', fmt.money(preview.summary.baselineTotalInterest)]] as [string, ReactNode][]),
                  ['Projected closure', fmt.date(preview.summary.closureDate)],
                  ['Outstanding today', fmt.money(preview.summary.outstandingPrincipal)],
                  ['Installments paid', `${preview.summary.installmentsPaid} of ${preview.summary.totalInstallments}`],
                  ['Next due', preview.summary.nextDue ? `${fmt.date(preview.summary.nextDue.date)} · ${fmt.money(preview.summary.nextDue.amount)}` : '—'],
                ]} />
              ) : <p className="muted">Complete the required fields to see the schedule.</p>}
              {preview?.summary.isEstimate && <div style={{ marginTop: 8 }}><Estimate label="Contains estimates" /></div>}
            </div>
          </div>
          {preview?.summary.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}
        </div>
      )}
    </Modal>
  );
}

/** Wizard step: whether to be reminded about this loan, how many days before, and the due-date settings. */
function ReminderStep({ loan: l, set, errors: e, upcoming }: { loan: Loan; set: <K extends keyof Loan>(k: K, v: Loan[K]) => void; errors: Record<string, string>; upcoming: string[] }) {
  const { prefs, fmt } = useStore();
  const offsets = l.reminderOffsets ?? prefs.reminders.offsets;
  const chit = l.loanType === 'chit_fund';
  const emi = chit ? 'installment' : 'EMI';
  const toggle = (d: number) => {
    const next = offsets.includes(d) ? offsets.filter((x) => x !== d) : [...offsets, d];
    set('reminderOffsets', next.sort((a, b) => b - a).slice(0, 10));
  };
  return (
    <div className="col">
      <div className="card tight" style={{ background: 'var(--surface-2)' }}>
        <div className="row between wrap">
          <div><b>Do you want reminders for this {chit ? "chit's installments" : "loan's EMIs"}?</b><div className="small muted">Windows notifications before each {emi} and on its due date.</div></div>
          <BtnGroup label="Reminders for this loan" value={l.reminderEnabled ? 'yes' : 'no'} onChange={(v) => set('reminderEnabled', v === 'yes')} options={[{ value: 'yes', label: 'Yes, remind me' }, { value: 'no', label: 'No reminders' }]} />
        </div>
      </div>
      {l.reminderEnabled && (
        <>
          {!prefs.reminders.enabled && <Callout kind="warn">All reminders are switched off in Reminders → Settings. Turn them on there too.</Callout>}
          <div className="field">
            <span className="field-label">Remind me this many days before each {emi}</span>
            <div className="row wrap" style={{ marginTop: 6 }}>
              {OFFSET_CHOICES.map((d) => <Check key={d} checked={offsets.includes(d)} onChange={() => toggle(d)} label={`${d} day${d === 1 ? '' : 's'} before`} />)}
            </div>
            <div className="tiny faint" style={{ marginTop: 6 }}>
              Plus a reminder on the due date itself, at {prefs.reminders.time} (change the time in Reminders → Settings).
              {l.reminderOffsets === null ? ' Using your default days.' : <> <button type="button" className="btn sm ghost" onClick={() => set('reminderOffsets', null)}>Use my default ({prefs.reminders.offsets.join(', ')})</button></>}
            </div>
            {e.reminderOffsets && <div className="small neg">{e.reminderOffsets}</div>}
          </div>
          <div className="form-grid">
            <TextInput label={chit ? 'First installment date' : 'First EMI date'} type="date" value={l.firstEmiDate} onChange={(v) => { set('firstEmiDate', v); if (isValidISODate(v)) set('emiDueDay', parts(v)[2]); }} error={e.firstEmiDate} />
            <TextInput label={chit ? 'Installment day of month' : 'EMI due day of month'} type="number" min={1} max={31} value={l.emiDueDay} onChange={(v) => set('emiDueDay', +v || 1)} error={e.emiDueDay} hint="31 means the last day of shorter months" />
          </div>
          {upcoming.length > 0 && (
            <div className="card tight">
              <div className="field-label" style={{ marginBottom: 6 }}>Your next reminders</div>
              {upcoming.map((due) => (
                <div key={due} className="small" style={{ padding: '3px 0' }}>
                  {chit ? 'Installment' : 'EMI'} due <b>{fmt.date(due)}</b>: {[...offsets].sort((a, b) => b - a).map((o) => fmt.date(addDays(due, -o))).concat(fmt.date(due)).join(', ')} at {prefs.reminders.time}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TYPE_HELP: Record<PaymentType, string> = {
  emi: 'Regular EMI against an installment', partial: 'Part of an installment', advance: 'EMI paid before its due date',
  prepayment: 'Extra principal paid on the transaction date', foreclosure: 'Closes the loan: pays interest to date and all principal',
  fee: 'Bounce charge, processing or other fee', penalty: 'Penal interest or late fee', missed: 'Mark an installment as missed (no amount)',
  waiver: 'Lender waived this installment (no amount)',
};

/** Record or edit a payment. */
export function PaymentForm({ loanId, initial, installmentNo, presetType, onClose }: { loanId?: string; initial?: Payment; installmentNo?: number; presetType?: PaymentType; onClose: () => void }) {
  const { data, comps, asOf, fmt, reload, toast } = useStore();
  const active = data.loans.filter((l) => l.status === 'active' || l.id === loanId || l.id === initial?.loanId);
  const [p, setP] = useState<Payment>(() => {
    if (initial) return initial;
    const lid = loanId ?? active[0]?.id ?? '';
    const r = installmentNo ? comps.get(lid)?.rows.find((x) => x.no === installmentNo) : undefined;
    const marker = presetType === 'missed' || presetType === 'waiver';
    return {
      ...blankPayment(lid, asOf), installmentNo: installmentNo ?? null,
      type: presetType ?? (r && r.dueDate > asOf ? 'advance' : 'emi'),
      amount: marker ? '0.00' : r ? (+r.shortfall > 0 ? r.shortfall : r.scheduledAmount) : '',
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Payment>(k: K, v: Payment[K]) => setP((x) => ({ ...x, [k]: v }));
  const comp = comps.get(p.loanId);
  const needsInst = ['emi', 'partial', 'advance', 'missed', 'waiver'].includes(p.type);
  const isChit = data.loans.find((l) => l.id === p.loanId)?.loanType === 'chit_fund';
  const marker = p.type === 'missed' || p.type === 'waiver';

  const openRows = useMemo(() => (comp?.rows ?? []).filter((r) => OPEN_STATUSES.includes(r.status) || r.no === p.installmentNo || r.paymentIds.includes(p.id)), [comp, p.installmentNo, p.id]);
  const row = comp?.rows.find((r) => r.no === p.installmentNo);

  // sensible defaults when the installment / type changes
  const pickInstallment = (no: number | null) => {
    setP((x) => {
      const r = comp?.rows.find((rr) => rr.no === no);
      const amt = r && !initial ? (+r.shortfall > 0 ? r.shortfall : r.scheduledAmount) : x.amount;
      return { ...x, installmentNo: no, amount: marker ? '0.00' : amt, type: !initial && r && r.dueDate > x.txnDate && x.type === 'emi' ? 'advance' : x.type };
    });
  };

  const payoff = comp ? (+comp.summary.payoffEstimate).toFixed(2) : '';

  const submit = async (allowDuplicate = false) => {
    const payload: Payment = { ...p, amount: marker ? '0.00' : (+p.amount || 0).toFixed(2), installmentNo: needsInst ? p.installmentNo : null,
      allocPrincipal: (+p.allocPrincipal || 0).toFixed(2), allocInterest: (+p.allocInterest || 0).toFixed(2), allocFees: (+p.allocFees || 0).toFixed(2), allocPenalty: (+p.allocPenalty || 0).toFixed(2) };
    const r = paymentSchema.safeParse(payload);
    if (!r.success) { setErrors(fieldErrors(r.error)); return; }
    if (payload.txnDate > asOf) { setErrors({ txnDate: 'Transaction date cannot be in the future' }); return; }
    setBusy(true);
    try {
      await call('payment:save', { payment: payload, allowDuplicate });
      await reload();
      toast({ kind: 'success', title: initial ? 'Payment updated' : marker ? 'Installment marked' : 'Payment recorded', body: `${PAYMENT_TYPE_LABEL[payload.type]} · ${fmt.money(payload.amount)}` });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate') setDup(e.message);
      else toast({ kind: 'error', title: 'Could not save payment', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!active.length) return <Modal title="Record a payment" onClose={onClose}><Callout>Add an active loan first.</Callout></Modal>;
  return (
    <Modal size="wide" title={initial ? 'Edit payment' : 'Record a payment'} sub="Transaction date is when money left your account; the installment's due date is tracked separately." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => submit()} disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Record'}</button></>}>
      <div className="col">
        <div className="form-grid">
          <Select label="Loan" value={p.loanId} onChange={(v) => setP((x) => ({ ...x, loanId: v, installmentNo: null }))} options={active.map((l) => ({ value: l.id, label: l.name }))} />
          <Select label="Type" value={p.type} onChange={(v) => { set('type', v); if (v === 'foreclosure') set('amount', payoff); if (v === 'missed' || v === 'waiver') set('amount', '0.00'); }}
            options={(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map((t) => ({ value: t, label: PAYMENT_TYPE_LABEL[t] }))} hint={TYPE_HELP[p.type]} />
          {needsInst && (
            <Select label="Installment" value={p.installmentNo ?? 0} onChange={(v) => pickInstallment(v || null)} error={errors.installmentNo}
              options={[{ value: 0, label: 'Choose…' }, ...openRows.map((r) => ({ value: r.no, label: `${r.emiNo ? `#${r.emiNo}` : `M${r.no}`} · due ${fmt.date(r.dueDate)} · ${fmt.money(+r.shortfall > 0 ? r.shortfall : r.scheduledAmount)}` }))]} />
          )}
          <TextInput label="Transaction date" type="date" value={p.txnDate} onChange={(v) => set('txnDate', v)} error={errors.txnDate} />
          {!marker && <MoneyInput label={isChit && needsInst ? 'Amount you paid' : 'Amount'} value={p.amount} onChange={(v) => set('amount', v)} error={errors.amount}
            hint={isChit && needsInst ? 'After any dividend. Less than the full installment? The difference is recorded as your dividend.' : undefined} />}
          <TextInput label="Reference (optional)" value={p.reference} onChange={(v) => set('reference', v)} placeholder="UTR / cheque / txn id" />
        </div>
        {row && needsInst && (
          <div className="card tight" style={{ background: 'var(--surface-2)' }}>
            <div className="row between wrap small">
              <span>Due {fmt.date(row.dueDate)} · <Status s={row.status} /></span>
              <span>Scheduled {fmt.money(row.scheduledAmount)} = interest {fmt.money(row.interest)} + principal {fmt.money(row.principalDue)}</span>
              {+row.shortfall > 0 && <span className="warn">Unpaid {fmt.money(row.shortfall)}</span>}
              {p.txnDate && diffDays(row.dueDate, p.txnDate) > 0 && <span className="neg">{diffDays(row.dueDate, p.txnDate)} days after due date</span>}
            </div>
          </div>
        )}
        {p.type === 'foreclosure' && comp && (
          <Callout kind="info">Estimated payoff today: <b>{fmt.money(comp.summary.payoffEstimate)}</b> (principal {fmt.money(comp.summary.outstandingPrincipal)} + accrued interest {fmt.money(comp.summary.accruedInterest)} + arrears + charges − advance EMI balance). <Estimate /> Enter the exact amount from your lender's foreclosure letter.</Callout>
        )}
        {!marker && !isChit && (
          <>
            <Switch checked={p.manualAllocation} onChange={(v) => set('manualAllocation', v)} label="Enter the lender's allocation manually" hint="Use the principal / interest split from your statement instead of the calculated one" />
            {p.manualAllocation && (
              <div className="form-grid">
                <MoneyInput label="Principal" value={p.allocPrincipal} onChange={(v) => set('allocPrincipal', v)} error={errors.allocPrincipal} />
                <MoneyInput label="Interest" value={p.allocInterest} onChange={(v) => set('allocInterest', v)} />
                <MoneyInput label="Fees" value={p.allocFees} onChange={(v) => set('allocFees', v)} />
                <MoneyInput label="Penalty" value={p.allocPenalty} onChange={(v) => set('allocPenalty', v)} />
              </div>
            )}
          </>
        )}
        <div className="form-grid">
          <div className="field full"><label htmlFor="pnotes">Notes</label><textarea id="pnotes" className="input" value={p.notes} onChange={(ev) => set('notes', ev.target.value)} maxLength={2000} /></div>
          <div className="row">
            <button className="btn sm" onClick={async () => { try { const name = await call<string | null>('attachment:add'); if (name) set('attachmentPath', name); } catch (err) { toast({ kind: 'error', title: 'Attachment failed', body: (err as Error).message }); } }}><Paperclip />{p.attachmentPath ? 'Replace attachment' : 'Attach receipt'}</button>
            {p.attachmentPath && <span className="small muted">{p.attachmentPath.replace(/^[0-9a-f-]{36}-/, '')}</span>}
          </div>
          <Check checked={p.reconciled} onChange={(v) => set('reconciled', v)} label="Reconciled with lender statement" />
        </div>
      </div>
      {dup && (
        <Confirm title="Possible duplicate" confirmLabel="Record anyway" onClose={() => setDup(null)} onConfirm={() => { setDup(null); void submit(true); }}>
          <Callout kind="warn"><AlertTriangle size={14} style={{ display: 'none' }} />{dup}. Record this payment anyway?</Callout>
        </Confirm>
      )}
    </Modal>
  );
}

export function ReverseDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { reload, toast, fmt } = useStore();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Reverse payment" sub="The record stays in your history, marked as reversed, with an audit entry." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason.trim() || busy} onClick={async () => {
        setBusy(true);
        try { await call('payment:reverse', { id: payment.id, reason }); await reload(); toast({ kind: 'success', title: 'Payment reversed' }); onClose(); }
        catch (e) { toast({ kind: 'error', title: 'Could not reverse', body: (e as Error).message }); } finally { setBusy(false); }
      }}>Reverse payment</button></>}>
      <div className="col">
        <Kv items={[['Type', PAYMENT_TYPE_LABEL[payment.type]], ['Amount', fmt.money(payment.amount)], ['Date', fmt.date(payment.txnDate)]]} />
        <TextInput label="Reason" value={reason} onChange={setReason} placeholder="e.g. Entered twice, bounced cheque" autoFocus />
      </div>
    </Modal>
  );
}

/** Rate change, EMI change or restructuring. */
export function AdjustmentForm({ loan, initial, onClose }: { loan: Loan; initial?: Adjustment; onClose: () => void }) {
  const { asOf, reload, toast } = useStore();
  const [a, setA] = useState<Adjustment>(() => initial ?? blankAdjustment(loan.id, asOf));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Adjustment>(k: K, v: Adjustment[K]) => setA((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const payload: Adjustment = { ...a, annualRate: a.annualRate ? a.annualRate : null, emiAmount: a.emiAmount ? (+a.emiAmount).toFixed(2) : null };
    const r = adjustmentSchema.safeParse(payload);
    if (!r.success) { setErrors(fieldErrors(r.error)); return; }
    try { await call('adjustment:save', payload); await reload(); toast({ kind: 'success', title: 'Change saved' }); onClose(); }
    catch (e) { toast({ kind: 'error', title: 'Could not save', body: (e as Error).message }); }
  };
  return (
    <Modal title={initial ? 'Edit loan change' : 'Add rate / EMI change'} sub="Effective from the date you choose; earlier installments are unaffected." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Select label="Kind" value={a.kind} onChange={(v) => set('kind', v)} options={[{ value: 'rate', label: 'Interest rate change' }, { value: 'emi', label: 'EMI amount change' }, { value: 'restructure', label: 'Restructuring' }]} error={errors.kind} />
        <TextInput label="Effective date" type="date" value={a.effectiveDate} onChange={(v) => set('effectiveDate', v)} error={errors.effectiveDate} />
        {(a.kind === 'rate' || a.kind === 'restructure') && <TextInput label="New annual rate" value={a.annualRate ?? ''} onChange={(v) => set('annualRate', v.replace(/[^\d.]/g, ''))} suffix="%" error={errors.annualRate} />}
        {a.kind === 'rate' && <Select label="Then" value={a.recalc} onChange={(v) => set('recalc', v)} options={[{ value: 'keep_emi', label: 'Keep EMI, change tenure' }, { value: 'recompute_emi', label: 'Keep tenure, change EMI' }]} />}
        {(a.kind === 'emi' || a.kind === 'restructure') && <MoneyInput label={a.kind === 'emi' ? 'New EMI' : 'New EMI (optional)'} value={a.emiAmount} onChange={(v) => set('emiAmount', v || null)} error={errors.emiAmount} hint={a.kind === 'restructure' ? 'Leave blank to recalculate' : undefined} />}
        {a.kind === 'restructure' && <TextInput label="Remaining installments" type="number" value={a.remainingInstallments ?? ''} onChange={(v) => set('remainingInstallments', v ? Math.max(1, Math.floor(+v)) : null)} error={errors.remainingInstallments} />}
        <TextInput label="Note" value={a.note} onChange={(v) => set('note', v)} className="full" />
      </div>
    </Modal>
  );
}
