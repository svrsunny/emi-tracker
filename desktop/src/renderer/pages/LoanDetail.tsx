import { useEffect, useState } from 'react';
import { Archive, ArrowLeft, CheckCircle2, Edit3, Landmark, Plus, RotateCcw, Trash2, TrendingUp, Wallet } from 'lucide-react';
import { maskRef } from '../../shared/format';
import type { Adjustment, Loan } from '../../shared/types';
import { call, type AuditEntry } from '../lib/api';
import { useRouter } from '../lib/router';
import { useAction, useStore } from '../lib/store';
import { BalanceChart } from '../components/charts';
import { AdjustmentForm, LoanWizard, PaymentForm } from '../components/forms';
import { ScheduleTable } from '../components/ScheduleTable';
import { PaymentLedger } from './Payments';
import { Callout, Card, Confirm, Empty, Estimate, Kv, LOAN_TYPE_LABEL, Money, Progress, Projected, Stat, Tabs } from '../components/ui';

type Tab = 'overview' | 'schedule' | 'payments' | 'changes' | 'history';

export function LoanDetail({ id }: { id: string }) {
  const { data, comps, fmt, asOf } = useStore();
  const { go, route } = useRouter();
  const act = useAction();
  const [tab, setTab] = useState<Tab>((route.query.get('tab') as Tab) || 'overview');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [adj, setAdj] = useState<Adjustment | 'new' | null>(null);
  const [confirm, setConfirm] = useState<null | 'close' | 'archive' | 'reopen' | 'delete'>(null);
  const loan = data.loans.find((l) => l.id === id);
  const comp = loan ? comps.get(loan.id) : undefined;

  if (!loan || !comp) {
    return <div className="page"><div className="card"><Empty icon={<Landmark />} title="Choose a loan" action={<button className="btn" onClick={() => go('/loans')}>All loans</button>}>Select a loan from the list to see its details, schedule and history.</Empty></div></div>;
  }
  const s = comp.summary;
  const adjustments = data.adjustments.filter((a) => a.loanId === loan.id).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const setStatus = (status: Loan['status']) => act(() => call('loan:status', { id: loan.id, status }), `Loan marked ${status}`);

  return (
    <div className="page">
      <button className="btn ghost sm no-print" onClick={() => go('/loans')} style={{ marginBottom: 8 }}><ArrowLeft />All loans</button>
      <div className="page-head">
        <div className="row">
          <span style={{ width: 42, height: 42, borderRadius: 11, background: `${loan.color}22`, color: loan.color, display: 'grid', placeItems: 'center' }}><Landmark size={20} /></span>
          <div>
            <h1 className="page-title">{loan.name} <span className="tag" style={{ verticalAlign: 'middle' }}>{loan.status}</span></h1>
            <p className="page-sub">{loan.lender || 'No lender'} · {LOAN_TYPE_LABEL[loan.loanType]} · {loan.category}{loan.accountRef ? ` · A/c ${maskRef(loan.accountRef, loan.maskAccountRef)}` : ''}</p>
          </div>
        </div>
        <div className="row wrap no-print">
          <button className="btn" onClick={() => setEdit(true)}><Edit3 />Edit</button>
          <button className="btn" onClick={() => setAdj('new')}><TrendingUp />Rate / EMI change</button>
          {loan.status === 'active' ? (
            <>
              {s.computedClosed && <button className="btn" onClick={() => setConfirm('close')}><CheckCircle2 />Mark closed</button>}
              <button className="btn" onClick={() => setConfirm('archive')}><Archive />Archive</button>
              <button className="btn primary" onClick={() => setPay(true)}><Wallet />Record payment</button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirm('reopen')}><RotateCcw />Reactivate</button>
          )}
          <button className="btn ghost icon" title="Delete permanently" aria-label="Delete loan permanently" onClick={() => setConfirm('delete')}><Trash2 /></button>
        </div>
      </div>

      {s.computedClosed && loan.status === 'active' && <div style={{ marginBottom: 12 }}><Callout kind="ok">All principal and interest on this loan are paid according to your records. Mark it closed to stop reminders.</Callout></div>}
      {s.warnings.length > 0 && <div className="col" style={{ marginBottom: 14, gap: 6 }}>{s.warnings.map((w) => <Callout key={w} kind="warn">{w}</Callout>)}</div>}

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'schedule', label: `Amortization (${comp.rows.length})` }, { value: 'payments', label: `Payments (${data.payments.filter((p) => p.loanId === loan.id).length})` }, { value: 'changes', label: `Rate & EMI changes (${adjustments.length})` }, { value: 'history', label: 'Audit history' }]} />

      {tab === 'overview' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="grid g4">
            <div className="card hero span2">
              <div className="stat-label">Outstanding principal {s.isEstimate && <Estimate />}</div>
              <div className="stat-value lg"><Money v={s.outstandingPrincipal} /></div>
              <div className="stat-foot">Calculated from your records — not the lender's figure</div>
              <div style={{ margin: '12px 0 6px' }}><Progress pct={s.progressPct} color={loan.color} /></div>
              <div className="row between small muted"><span>{s.progressPct.toFixed(1)}% repaid</span><span>Installment {s.currentInstallment ? comp.rows.find((r) => r.no === s.currentInstallment)?.emiNo ?? s.currentInstallment : '—'} of {s.totalInstallments}</span></div>
            </div>
            <Stat label="Next EMI" value={s.nextDue ? <Money v={s.nextDue.amount} /> : '—'} foot={s.nextDue ? `${s.nextDue.status === 'overdue' ? 'Overdue since' : 'Due'} ${fmt.date(s.nextDue.date)}` : 'Nothing due'} tone={s.nextDue?.status === 'overdue' ? 'neg' : undefined} />
            <Stat label="Expected closure" value={s.closureDate ? fmt.month(s.closureDate.slice(0, 7)) : s.nonConverging ? <span className="neg">Never</span> : '—'} foot={s.closureDate ? `Last payment ${fmt.date(s.closureDate)}` : ''} tag={<Projected />} />
          </div>
          <div className="grid g4">
            <Card title="Installments">
              <Kv items={[['Total scheduled', s.totalInstallments], ['Paid', s.installmentsPaid], ['Remaining', s.installmentsRemaining], ['Overdue', s.overdueCount ? <span className="neg">{s.overdueCount} · {fmt.money(s.overdueAmount)}</span> : 0], ['Current EMI', <Money key="e" v={s.currentEmi} />]]} />
            </Card>
            <Card title="Paid to date">
              <Kv items={loan.loanType === 'chit_fund'
                ? [['Installments paid', <Money key="p" v={s.principalRepaid} />], ['Dividends received', <span key="d" className="pos"><Money v={s.dividends} /></span>], ['Fees & charges', <Money key="f" v={s.feesPaid} />], ['Total paid', <b key="t"><Money v={s.totalPaid} /></b>]]
                : [['Principal repaid', <Money key="p" v={s.principalRepaid} />], ['Interest paid', <Money key="i" v={s.interestPaid} />], ['Fees & charges', <Money key="f" v={s.feesPaid} />], ['Penalties', <Money key="pe" v={s.penaltiesPaid} />], ['Total paid', <b key="t"><Money v={s.totalPaid} /></b>]]} />
              {+s.principalRepaidEstimated > 0 && <div className="tiny warn" style={{ marginTop: 6 }}>Includes {fmt.money(+s.principalRepaidEstimated + +s.interestPaidEstimated)} assumed before tracking</div>}
              {+s.unapplied > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>{fmt.money(s.unapplied)} unapplied (excess over amount due)</div>}
            </Card>
            <Card title="Remaining" sub="If every EMI is paid on schedule">
              <Kv items={[['Scheduled EMIs', <Money key="s" v={s.remainingScheduledAmount} />], ['Est. interest', <Money key="i" v={s.remainingInterest} />], ['Est. fees / charges due', <Money key="f" v={s.remainingFees} />], ['Overdue amount', <Money key="o" v={s.overdueAmount} />], ['Total future outflow', <b key="t"><Money v={s.remainingCashOutflow} /></b>]]} />
            </Card>
            {loan.loanType !== 'chit_fund' && <Card title="Prepayment impact" sub="Versus the original contract">
              <Kv items={[['Contract interest', <Money key="b" v={s.baselineTotalInterest} />], ['Lifetime interest now', <Money key="l" v={s.lifetimeInterest} />],
                [+s.interestSaved >= 0 ? 'Interest saved' : 'Extra interest', <span key="s" className={+s.interestSaved >= 0 ? 'pos' : 'neg'}><Money v={Math.abs(+s.interestSaved)} /></span>],
                [s.periodsSaved >= 0 ? 'Installments saved' : 'Installments added', Math.abs(s.periodsSaved)], ['Contract closure', fmt.date(s.baselineClosureDate)]]} />
              <div className="tiny faint" style={{ marginTop: 6 }}><Estimate /> Missed or late payments reduce savings.</div>
            </Card>}
          </div>
          <div className="grid g3">
            <Card title="Outstanding balance" sub="Actual to date, projected afterwards" className="span2"><BalanceChart rows={comp.rows} /></Card>
            <Card title="Loan terms">
              <Kv items={[
                ['Sanctioned', <Money key="s" v={loan.sanctionedAmount} />], ['Disbursed', <Money key="d" v={loan.disbursedAmount} />], ['Original principal', <Money key="p" v={loan.principal} />],
                ...(loan.loanType === 'chit_fund' ? [['Type', 'Chit fund · no interest']] as [string, string][] : [['Current rate', `${comp.rows.find((r) => r.no === s.currentInstallment)?.rate ?? loan.annualRate}% ${loan.rateType}`], ['Method', loan.interestMethod.replace(/_/g, ' ')]] as [string, string][]),
                ['Frequency', loan.frequency.replace('_', '-')], ['Start', fmt.date(loan.startDate)], ['First EMI', fmt.date(loan.firstEmiDate)], ['Due day', loan.emiDueDay],
                ['Grace period', `${loan.gracePeriodDays} days`], ['Prepayment effect', loan.prepaymentEffect === 'reduce_tenure' ? 'Reduce tenure' : 'Reduce EMI'],
                ['Payoff estimate today', <span key="po"><Money v={s.payoffEstimate} /> <Estimate /></span>],
              ]} />
            </Card>
          </div>
          {s.reconciliation && (
            <Card title="Lender reconciliation" sub={`Lender statement as of ${fmt.date(s.reconciliation.date)}`}>
              <div className="grid g3">
                <Stat label="Lender's outstanding" value={<Money v={s.reconciliation.lenderOutstanding} />} />
                <Stat label="Calculated principal" value={<Money v={s.reconciliation.calculated} />} />
                <Stat label="Difference" value={<Money v={s.reconciliation.difference} />} tone={Math.abs(+s.reconciliation.difference) > 1 ? 'warn' : 'pos'} foot={Math.abs(+s.reconciliation.difference) > 1 ? 'Lender balance may include accrued interest or charges. Review recent payments or record the lender allocation.' : 'Matches within ₹1'} />
              </div>
            </Card>
          )}
          {loan.notes && <Card title="Notes"><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{loan.notes}</p></Card>}
        </div>
      )}

      {tab === 'schedule' && <ScheduleTable loan={loan} comp={comp} />}
      {tab === 'payments' && <PaymentLedger loanId={loan.id} />}
      {tab === 'changes' && (
        <Card title="Interest rate, EMI and restructuring history" actions={<button className="btn sm" onClick={() => setAdj('new')}><Plus />Add change</button>}>
          {!adjustments.length ? <p className="muted">No changes recorded. The loan uses {loan.annualRate}% from {fmt.date(loan.startDate)}.</p> : (
            <table className="data">
              <thead><tr><th>Effective</th><th>Change</th><th>Effect</th><th>Note</th><th /></tr></thead>
              <tbody>
                <tr><td>{fmt.date(loan.startDate)}</td><td>Initial rate {loan.annualRate}%</td><td className="muted">Contract</td><td /><td /></tr>
                {adjustments.map((a) => (
                  <tr key={a.id}>
                    <td>{fmt.date(a.effectiveDate)}{a.effectiveDate > asOf && <span className="tag proj" style={{ marginLeft: 6 }}>Future</span>}</td>
                    <td>{a.kind === 'rate' ? `Rate → ${a.annualRate}%` : a.kind === 'emi' ? `EMI → ${fmt.money(a.emiAmount)}` : `Restructure${a.annualRate ? ` · ${a.annualRate}%` : ''}${a.remainingInstallments ? ` · ${a.remainingInstallments} installments` : ''}${a.emiAmount ? ` · EMI ${fmt.money(a.emiAmount)}` : ''}`}</td>
                    <td className="muted">{a.kind === 'rate' ? (a.recalc === 'keep_emi' ? 'EMI kept, tenure adjusts' : 'Tenure kept, EMI recalculated') : a.kind === 'emi' ? 'Tenure adjusts' : 'EMI recalculated'}</td>
                    <td className="muted">{a.note}</td>
                    <td className="right"><button className="btn sm ghost" onClick={() => setAdj(a)}>Edit</button><button className="btn sm ghost" onClick={() => act(() => call('adjustment:delete', { id: a.id }), 'Change removed')}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === 'history' && <AuditList entityIds={[loan.id, ...data.payments.filter((p) => p.loanId === loan.id).map((p) => p.id), ...adjustments.map((a) => a.id)]} />}

      {edit && <LoanWizard initial={loan} onClose={() => setEdit(false)} />}
      {pay && <PaymentForm loanId={loan.id} onClose={() => setPay(false)} />}
      {adj && <AdjustmentForm loan={loan} initial={adj === 'new' ? undefined : adj} onClose={() => setAdj(null)} />}
      {confirm === 'close' && <Confirm title="Mark loan closed?" confirmLabel="Mark closed" onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void setStatus(s.closureDate && s.closureDate < asOf && data.payments.some((p) => p.loanId === loan.id && p.type === 'foreclosure' && p.status === 'active') ? 'foreclosed' : 'closed'); }}>Reminders stop for this loan. All records stay and you can reactivate it at any time.</Confirm>}
      {confirm === 'archive' && <Confirm title="Archive this loan?" confirmLabel="Archive" onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void setStatus('archived'); }}>Archived loans are hidden from the dashboard and reminders. Their payment history is kept.</Confirm>}
      {confirm === 'reopen' && <Confirm title="Reactivate loan?" confirmLabel="Reactivate" onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void setStatus('active'); }}>The loan returns to the dashboard and reminders resume.</Confirm>}
      {confirm === 'delete' && (
        <Confirm title="Delete loan permanently?" danger confirmLabel="Delete permanently" typeToConfirm={loan.name} onClose={() => setConfirm(null)}
          onConfirm={async () => { setConfirm(null); const r = await act(() => call<{ recoveryBackup: string }>('loan:delete', { id: loan.id, confirmName: loan.name })); if (r) go('/loans'); }}>
          <Callout kind="danger">This removes the loan and its {data.payments.filter((p) => p.loanId === loan.id).length} payment record(s). A recovery backup is created first. Prefer <b>Archive</b> if you only want to hide it.</Callout>
        </Confirm>
      )}
    </div>
  );
}

export function AuditList({ entityIds }: { entityIds?: string[] }) {
  const { data } = useStore();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void call<AuditEntry[]>('audit:list', { limit: 2000 }).then((xs) => { if (live) setItems(entityIds ? xs.filter((x) => x.entityId && entityIds.includes(x.entityId)) : xs); });
    return () => { live = false; };
  }, [data, entityIds?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return <p className="muted">Loading…</p>;
  if (!items.length) return <Card><p className="muted">No audit entries yet.</p></Card>;
  return (
    <div className="card flush table-wrap" style={{ maxHeight: 560 }}>
      <table className="data">
        <thead><tr><th>When</th><th>Area</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}><td className="nowrap muted">{new Date(a.at).toLocaleString()}</td><td>{a.entity}</td><td>{a.action}</td><td>{a.summary}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
