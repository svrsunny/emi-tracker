import { useMemo, useState } from 'react';
import { LineChart, Plus, Trash2 } from 'lucide-react';
import { combinedProjection, EMPTY_SCENARIO, runScenario, type Scenario, type ScenarioResult } from '../../shared/forecast';
import { MONTH_NAMES } from '../../shared/format';
import { useStore } from '../lib/store';
import { BalanceChart } from '../components/charts';
import { ClosureTimeline } from './Dashboard';
import { Callout, Card, Empty, Estimate, Money, MoneyInput, Projected, Select, TextInput } from '../components/ui';

const PRESETS: Scenario[] = [
  { ...EMPTY_SCENARIO, name: 'EMI +10%' },
  { ...EMPTY_SCENARIO, name: 'Extra ₹5,000 / month', extraMonthly: '5000' },
  { ...EMPTY_SCENARIO, name: 'Annual bonus prepayment', annualAmount: '100000', annualMonth: 4 },
];

export function Forecast() {
  const { data, comps, asOf, fmt } = useStore();
  const active = data.loans.filter((l) => l.status === 'active');
  const [loanId, setLoanId] = useState(active[0]?.id ?? '');
  const loan = data.loans.find((l) => l.id === loanId);
  const base = loan ? comps.get(loan.id) : undefined;
  const [scenarios, setScenarios] = useState<Scenario[]>(() => {
    const emi = base ? +base.summary.currentEmi : 0;
    return [{ ...PRESETS[0], emiIncrease: emi ? String(Math.round(emi * 0.1)) : '' }, PRESETS[1]];
  });
  const [chartIdx, setChartIdx] = useState(0);

  const results = useMemo<ScenarioResult[]>(() => {
    if (!loan || !base) return [];
    return scenarios.map((s) => runScenario(loan, data.adjustments, data.payments, asOf, s, base));
  }, [loan, base, scenarios, data.adjustments, data.payments, asOf]);

  const combined = combinedProjection(active.map((l) => comps.get(l.id)!).filter(Boolean));
  if (!active.length) return <div className="page"><div className="card"><Empty icon={<LineChart />} title="No active loans">Forecasts need at least one active loan.</Empty></div></div>;
  const s = base!.summary;
  const update = (i: number, patch: Partial<Scenario>) => setScenarios((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Forecasts & what-if scenarios</h1><p className="page-sub">Projections run the same amortization rules on your actual remaining balance — never balance ÷ EMI.</p></div>
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Card title="All active loans" sub="Combined contractual projection" className="span2">
          <div className="grid g2">
            <div><div className="stat-label">Debt-free by <Projected /></div><div className="stat-value">{combined.anyOpenEnded ? <span className="neg">Not at current EMIs</span> : combined.allClosedBy ? fmt.month(combined.allClosedBy.slice(0, 7)) : '—'}</div><div className="stat-foot">{fmt.date(combined.allClosedBy)}</div></div>
            <div><div className="stat-label">Remaining outflow</div><div className="stat-value"><Money v={combined.remainingOutflow} /></div><div className="stat-foot">incl. {fmt.money(combined.remainingInterest)} interest</div></div>
          </div>
        </Card>
        <Card title="Closure timeline" className="span2"><ClosureTimeline loanIds={active.map((l) => l.id)} /></Card>
      </div>

      <Card title="Scenario comparison" sub="Hypothetical — nothing here changes your records" actions={
        <div className="row">
          <div style={{ width: 240 }}><Select label={<span className="sr-only">Loan</span>} value={loanId} onChange={setLoanId} options={active.map((l) => ({ value: l.id, label: l.name }))} /></div>
          <button className="btn sm" disabled={scenarios.length >= 4} onClick={() => setScenarios((xs) => [...xs, { ...EMPTY_SCENARIO, name: `Scenario ${xs.length + 1}` }])}><Plus />Add scenario</button>
        </div>
      }>
        {s.isEstimate && <div style={{ marginBottom: 10 }}><Callout kind="warn">This loan's figures include estimates ({s.warnings[0]}). Scenario results inherit that uncertainty.</Callout></div>}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th style={{ width: 220 }} />
                <th>Current contract <span className="tag">Contractual</span></th>
                {scenarios.map((sc, i) => <th key={i}><div className="row between"><input className="input" style={{ height: 26 }} value={sc.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Scenario name" /><button className="btn ghost icon sm" aria-label="Remove scenario" onClick={() => setScenarios((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div></th>)}
              </tr>
            </thead>
            <tbody>
              <tr><td className="muted">Increase EMI by</td><td className="faint">—</td>{scenarios.map((sc, i) => <td key={i}><MoneyInput label={<span className="sr-only">EMI increase</span>} value={sc.emiIncrease} onChange={(v) => update(i, { emiIncrease: v })} /></td>)}</tr>
              <tr><td className="muted">Extra principal every installment</td><td className="faint">—</td>{scenarios.map((sc, i) => <td key={i}><MoneyInput label={<span className="sr-only">Extra monthly</span>} value={sc.extraMonthly} onChange={(v) => update(i, { extraMonthly: v })} /></td>)}</tr>
              <tr><td className="muted">One-time prepayment · date</td><td className="faint">—</td>{scenarios.map((sc, i) => <td key={i}><div className="row" style={{ gap: 4 }}><MoneyInput label={<span className="sr-only">One-time amount</span>} value={sc.oneTimeAmount} onChange={(v) => update(i, { oneTimeAmount: v })} /><TextInput label={<span className="sr-only">Date</span>} type="date" value={sc.oneTimeDate ?? ''} onChange={(v) => update(i, { oneTimeDate: v || null })} /></div></td>)}</tr>
              <tr><td className="muted">Annual prepayment · month</td><td className="faint">—</td>{scenarios.map((sc, i) => <td key={i}><div className="row" style={{ gap: 4 }}><MoneyInput label={<span className="sr-only">Annual amount</span>} value={sc.annualAmount} onChange={(v) => update(i, { annualAmount: v })} /><Select label={<span className="sr-only">Month</span>} value={sc.annualMonth} onChange={(v) => update(i, { annualMonth: v })} options={MONTH_NAMES.map((m, k) => ({ value: k + 1, label: m }))} /></div></td>)}</tr>
              <tr><td className="muted">New interest rate · effect</td><td>{base!.rows.find((r) => r.no === s.currentInstallment)?.rate ?? loan!.annualRate}%</td>{scenarios.map((sc, i) => <td key={i}><div className="row" style={{ gap: 4 }}><TextInput label={<span className="sr-only">Rate</span>} value={sc.newRate} onChange={(v) => update(i, { newRate: v.replace(/[^\d.]/g, '') })} suffix="%" placeholder="same" /><Select label={<span className="sr-only">Effect</span>} value={sc.rateRecalc} onChange={(v) => update(i, { rateRecalc: v })} options={[{ value: 'keep_emi', label: 'Keep EMI' }, { value: 'recompute_emi', label: 'New EMI' }]} /></div></td>)}</tr>
              <tr><td className="muted">Prepayments</td><td className="muted">{loan!.prepaymentEffect === 'reduce_tenure' ? 'Reduce tenure' : 'Reduce EMI'}</td>{scenarios.map((sc, i) => <td key={i}><Select label={<span className="sr-only">Prepayment effect</span>} value={sc.prepaymentEffect} onChange={(v) => update(i, { prepaymentEffect: v })} options={[{ value: 'loan_default', label: 'Loan setting' }, { value: 'reduce_tenure', label: 'Reduce tenure' }, { value: 'reduce_emi', label: 'Reduce EMI' }]} /></td>)}</tr>
              <tr style={{ background: 'var(--surface-2)' }}><td><b>Revised closure</b></td><td><b>{s.closureDate ? fmt.month(s.closureDate.slice(0, 7)) : '—'}</b></td>{results.map((r, i) => <td key={i}><b>{r.nonConverging ? <span className="neg">Never</span> : r.closureDate ? fmt.month(r.closureDate.slice(0, 7)) : '—'}</b></td>)}</tr>
              <tr><td>Months saved</td><td className="faint">—</td>{results.map((r, i) => <td key={i} className={r.monthsSaved > 0 ? 'pos' : r.monthsSaved < 0 ? 'neg' : ''}>{r.monthsSaved > 0 ? `${r.monthsSaved} earlier` : r.monthsSaved < 0 ? `${-r.monthsSaved} later` : 'No change'}</td>)}</tr>
              <tr><td>Remaining interest</td><td><Money v={s.remainingInterest} /></td>{results.map((r, i) => <td key={i}><Money v={r.remainingInterest} /></td>)}</tr>
              <tr><td>Interest saved</td><td className="faint">—</td>{results.map((r, i) => <td key={i} className={+r.interestSaved > 0 ? 'pos' : +r.interestSaved < 0 ? 'neg' : ''}><Money v={r.interestSaved} /></td>)}</tr>
              <tr><td>Revised total repayment</td><td><Money v={s.remainingCashOutflow} /></td>{results.map((r, i) => <td key={i}><Money v={r.totalRepayment} /></td>)}</tr>
              <tr><td>Extra cash needed / month</td><td className="faint">—</td>{results.map((r, i) => <td key={i}><Money v={r.extraMonthlyCash} />{+scenarios[i].annualAmount > 0 && <div className="tiny faint">+ {fmt.money(scenarios[i].annualAmount)} each {MONTH_NAMES[scenarios[i].annualMonth - 1]}</div>}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <div className="tiny faint" style={{ marginTop: 8 }}><Estimate label="Projection" /> Assumes every future EMI is paid on its due date and that the rate stays as entered.</div>
      </Card>

      {results.length > 0 && (
        <Card title="Outstanding balance: contract vs scenario" className="span-all" actions={<Select label={<span className="sr-only">Scenario</span>} value={Math.min(chartIdx, results.length - 1)} onChange={setChartIdx} options={results.map((r, i) => ({ value: i, label: r.name }))} />}>
          <div style={{ marginTop: 4 }} />
          <BalanceChart rows={base!.rows} compare={results[Math.min(chartIdx, results.length - 1)].computation.rows.filter((r) => r.dueDate > asOf)} />
        </Card>
      )}
    </div>
  );
}
