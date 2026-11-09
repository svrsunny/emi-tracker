import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, BellPlus, CalendarClock, Landmark, LayoutGrid, Plus, Sparkles, Wallet } from 'lucide-react';
import { annualSummary, dailyCells, dashboardTotals, monthlySeries, type Filters, type Portfolio } from '../../shared/aggregate';
import { addMonths, addDays, fmtISO, parts } from '../../shared/dates';
import { monthlyExpenses } from '../../shared/bills';
import { blankReminder, DASHBOARD_WIDGETS } from '../../shared/defaults';
import type { CustomReminder } from '../../shared/types';
import { call } from '../lib/api';
import { useRouter } from '../lib/router';
import { useAction, useStore } from '../lib/store';
import { ActualVsScheduledChart, Donut, InterestTrendChart, MonthlyPaymentsChart, YearBars, useColors } from '../components/charts';
import { DailyHeatmap, IntensityLegend, PALETTES } from '../components/heatmap';
import { LoanWizard, PaymentForm } from '../components/forms';
import { CustomReminderForm } from './Reminders';
import { SyncNowButton } from '../components/SyncNow';
import { BtnGroup, Card, Check, Empty, Estimate, Modal, Money, Progress, Stat, Status } from '../components/ui';

export function rangeFor(r: string, asOf: string): { from: string | null; to: string | null } {
  switch (r) {
    case '3m': return { from: addMonths(asOf, -3), to: asOf };
    case '6m': return { from: addMonths(asOf, -6), to: asOf };
    case '12m': return { from: addMonths(asOf, -12), to: asOf };
    case 'ytd': return { from: fmtISO(parts(asOf)[0], 1, 1), to: asOf };
    default: return { from: null, to: null };
  }
}

export function LoanFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useStore();
  return (
    <select className="input" style={{ width: 200, height: 30 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by loan">
      <option value="">All loans</option>
      {data.loans.filter((l) => l.status !== 'archived').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );
}

export function Dashboard() {
  const { data, comps, asOf, fmt, prefs, savePrefs } = useStore();
  const { go } = useRouter();
  const act = useAction();
  const c = useColors();
  const [range, setRange] = useState<string>(prefs.dashboardRange);
  const [loanId, setLoanId] = useState('');
  const [wizard, setWizard] = useState(false);
  const [payment, setPayment] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [reminder, setReminder] = useState<CustomReminder | null>(null);

  const portfolio: Portfolio = { loans: data.loans, comps, payments: data.payments };
  const filters: Filters = { loanIds: loanId ? [loanId] : null, ...rangeFor(range, asOf) };
  const t = useMemo(() => dashboardTotals(portfolio, asOf, filters), [data, comps, asOf, loanId, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const series = useMemo(() => monthlySeries(portfolio, filters, asOf), [data, comps, asOf, loanId, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const historySeries = series.filter((s) => s.month <= asOf.slice(0, 7));

  if (!data.loans.length) {
    return (
      <div className="page">
        <div className="card hero" style={{ padding: 32 }}>
          <Empty icon={<Landmark />} title="Track every loan, privately" action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setWizard(true)}><Plus />Add your first loan</button>
              <button className="btn" onClick={() => setReminder(blankReminder(asOf))}><BellPlus />Add a reminder</button>
              <button className="btn" onClick={() => act(() => call('demo:load'), 'Demo loans added — delete them any time')}><Sparkles />Explore with demo data</button>
            </div>
          }>
            Add your loans to see what you've paid, what remains, when each loan closes and how prepayments change the picture. Everything is stored only on this computer.
          </Empty>
        </div>
        {wizard && <LoanWizard onClose={() => setWizard(false)} />}
        {reminder && <CustomReminderForm initial={reminder} onClose={() => setReminder(null)} />}
      </div>
    );
  }

  const visible = prefs.dashboardWidgets.filter((w) => w.visible).map((w) => w.id);
  const activeLoans = data.loans.filter((l) => l.status === 'active' && (!loanId || l.id === loanId));
  const yearData = annualSummary(portfolio, { loanIds: filters.loanIds });

  const widgets: Record<string, ReactNode> = {
    summary: (
      <div key="summary" className="col span-all" style={{ gap: 14 }}>
        <div className="grid g4">
          <div className="card hero span2">
            <div className="row between">
              <div>
                <div className="stat-label">Outstanding principal {t.isEstimate && <Estimate />}</div>
                <div className="stat-value lg"><Money v={t.outstandingPrincipal} /></div>
                <div className="stat-foot">of {fmt.money(t.originalPrincipal)} borrowed · {t.activeLoans} active, {t.closedLoans} closed</div>
              </div>
              <div className="right">
                <div className="stat-label" style={{ justifyContent: 'flex-end' }}>All loans closed by</div>
                <div className="stat-value">{t.anyOpenEnded ? <span className="neg">Never at current EMI</span> : t.allClosedBy ? fmt.month(t.allClosedBy.slice(0, 7)) : '—'}</div>
                <div className="stat-foot">{t.allClosedBy ? fmt.date(t.allClosedBy) : ''} · projected</div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}><Progress pct={t.progressPct} /></div>
            <div className="row between small muted" style={{ marginTop: 6 }}><span>{t.progressPct.toFixed(1)}% of principal repaid</span><span>{t.remainingInstallments} installments remaining</span></div>
          </div>
          <Stat label="Total paid to date" value={<Money v={t.totalPaid} />} foot={+t.estimatedPortion > 0 ? <>incl. {fmt.money(t.estimatedPortion)} assumed before tracking</> : 'All recorded payments + upfront charges'} />
          <Stat label="Future cash outflow" value={<Money v={t.remainingOutflow} />} foot="Remaining EMIs, overdue amounts & estimated charges" tag={<Estimate label="Projected" />} />
        </div>
        <div className="grid g-auto">
          <Stat label="Principal repaid" value={<Money v={t.principalRepaid} />} tone="pos" />
          <Stat label="Interest paid" value={<Money v={t.interestPaid} />} />
          <Stat label="Fees, penalties & charges" value={<Money v={t.chargesPaid} />} />
          <Stat label="Outstanding interest" value={<Money v={t.outstandingInterest} />} foot="Arrears + accrued since last due date" />
          <Stat label="Remaining scheduled EMIs" value={<Money v={t.remainingScheduled} />} foot={`${t.remainingInstallments} installments`} />
          <Stat label="Est. remaining interest" value={<Money v={t.remainingInterest} />} foot="If every EMI is paid on schedule" />
          <Stat label="Sanctioned (total)" value={<Money v={t.sanctioned} />} />
          <Stat label={`Paid in selected range`} value={<Money v={t.paidInRange} />} foot={range === 'all' ? 'All time' : `${filters.from ? fmt.date(filters.from) : ''} – ${fmt.date(asOf)}`} />
        </div>
      </div>
    ),
    due: (
      <Card key="due" title="Due & overdue" sub="Never inferred from dates alone — only recorded payments count" className="span2" actions={<button className="btn sm" onClick={() => setPayment(true)}><Plus />Record payment</button>}>
        <div className="grid g4" style={{ marginBottom: 12 }}>
          <MiniCount label="Overdue" n={t.overdue.length} tone="neg" />
          <MiniCount label="Due today" n={t.dueToday.length} tone="warn" />
          <MiniCount label="Next 7 days" n={t.due7.length} />
          <MiniCount label="Next 30 days" n={t.due30.length} />
        </div>
        {t.nextEmi && (
          <div className="card tight interactive" style={{ background: 'var(--surface-2)', marginBottom: 10 }} onClick={() => go(`/loans/${t.nextEmi!.loanId}`)}>
            <div className="row between">
              <span className="row"><CalendarClock size={16} className="faint" /><span><span className="muted">Next EMI · </span>{t.nextEmi.loanName}</span></span>
              <span><b className="money">{fmt.money(t.nextEmi.amount)}</b> <span className="muted">on {fmt.date(t.nextEmi.date)}</span></span>
            </div>
          </div>
        )}
        <div className="table-wrap" style={{ maxHeight: 220 }}>
          <table className="data">
            <tbody>
              {[...t.overdue, ...t.dueToday, ...t.due30].slice(0, 12).map((d) => (
                <tr key={`${d.loanId}-${d.no}`} className="clickable" onClick={() => go(`/loans/${d.loanId}`)}>
                  <td>{d.loanName}</td><td className="muted">{fmt.date(d.date)}</td><td><Status s={d.status} /></td><td className="num"><Money v={d.amount} /></td>
                </tr>
              ))}
              {![...t.overdue, ...t.dueToday, ...t.due30].length && <tr><td className="muted">Nothing due in the next 30 days.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    ),
    breakdown: (
      <Card key="breakdown" title="Principal vs interest" sub="Paid to date">
        <Donut data={[{ name: 'Principal repaid', value: +t.principalRepaid, color: c.accent }, { name: 'Interest paid', value: +t.interestPaid, color: c.warning }, { name: 'Fees & charges', value: +t.chargesPaid, color: c.danger }]}
          center={<div><div className="tiny faint">Interest share</div><div className="stat-value">{+t.totalPaid ? ((+t.interestPaid / +t.totalPaid) * 100).toFixed(1) : '0.0'}%</div></div>} />
        <Legend items={[[c.accent, 'Principal', t.principalRepaid], [c.warning, 'Interest', t.interestPaid], [c.danger, 'Charges', t.chargesPaid]]} />
      </Card>
    ),
    paidRemaining: (
      <Card key="paidRemaining" title="Paid vs remaining" sub="Total cost of all loans">
        <Donut data={[{ name: 'Paid to date', value: +t.totalPaid, color: c.positive }, { name: 'Remaining (projected)', value: +t.remainingOutflow, color: c.surface3 }]}
          center={<div><div className="tiny faint">Paid</div><div className="stat-value">{(+t.totalPaid + +t.remainingOutflow) ? ((+t.totalPaid / (+t.totalPaid + +t.remainingOutflow)) * 100).toFixed(0) : 0}%</div></div>} />
        <Legend items={[[c.positive, 'Paid', t.totalPaid], [c.surface3, 'Remaining', t.remainingOutflow]]} />
      </Card>
    ),
    progress: (
      <Card key="progress" title="Loan-wise progress" sub="Principal repaid of total" className="span2">
        <div className="col" style={{ gap: 14 }}>
          {activeLoans.map((l) => {
            const s = comps.get(l.id)!.summary;
            return (
              <button key={l.id} className="col" style={{ gap: 6, border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => go(`/loans/${l.id}`)}>
                <div className="row between small"><span className="row"><span className="swatch" style={{ background: l.color }} />{l.name}</span>
                  <span className="muted"><Money v={s.outstandingPrincipal} /> left · {s.progressPct.toFixed(1)}% · closes {s.closureDate ? fmt.month(s.closureDate.slice(0, 7)) : '—'}</span></div>
                <Progress pct={s.progressPct} color={l.color} />
              </button>
            );
          })}
          {!activeLoans.length && <p className="muted">No active loans.</p>}
        </div>
      </Card>
    ),
    monthly: (
      <Card key="monthly" title="Monthly payment history" sub="Recorded payments split into principal, interest and fees · click a month to open its payments" className="span2">
        {historySeries.length ? <MonthlyPaymentsChart data={historySeries} onMonth={(m) => go(`/payments?month=${m}`)} /> : <p className="muted">No payments in this range.</p>}
      </Card>
    ),
    actualVsScheduled: (
      <Card key="actualVsScheduled" title="Actual vs scheduled" sub="Recorded payments against EMIs due; future months projected" className="span2">
        <ActualVsScheduledChart data={series.filter((s) => s.month <= addMonths(asOf, 6).slice(0, 7))} />
      </Card>
    ),
    interestTrend: (
      <Card key="interestTrend" title="Interest paid over time" sub="Cumulative, from recorded payments">
        <InterestTrendChart data={historySeries} />
      </Card>
    ),
    timeline: (
      <Card key="timeline" title="Loan closure timeline" sub="Projected last payment per loan" className="span2"><ClosureTimeline loanIds={activeLoans.map((l) => l.id)} /></Card>
    ),
    calendar: (
      <Card key="calendar" title="Upcoming payments" sub="Next 60 days" actions={<button className="btn sm ghost" onClick={() => go('/calendar')}>Open calendar</button>}>
        <UpcomingList days={60} loanId={loanId} />
      </Card>
    ),
    distribution: (
      <Card key="distribution" title="Payment distribution by year" sub="Principal, interest and fees per calendar year">
        {yearData.length ? <YearBars data={yearData} /> : <p className="muted">No payments yet.</p>}
      </Card>
    ),
    heatmap: (
      <Card key="heatmap" title="Repayment activity" sub="Last 12 months · amount paid per day" className="span-all" actions={<button className="btn sm ghost" onClick={() => go('/heatmaps')}>Open heatmaps</button>}>
        <MiniHeatmap portfolio={portfolio} loanId={loanId} />
      </Card>
    ),
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Dashboard</h1><p className="page-sub">Your complete loan position as of {fmt.date(asOf)}</p></div>
        <div className="row wrap">
          <LoanFilter value={loanId} onChange={setLoanId} />
          <BtnGroup label="Date range" value={range} onChange={setRange} options={[{ value: '3m', label: '3M' }, { value: '6m', label: '6M' }, { value: '12m', label: '12M' }, { value: 'ytd', label: 'YTD' }, { value: 'all', label: 'All' }]} />
          <SyncNowButton />
          <button className="btn" onClick={() => setCustomize(true)}><LayoutGrid />Customize</button>
          <button className="btn" onClick={() => setReminder(blankReminder(asOf))}><BellPlus />Add reminder</button>
          <button className="btn" onClick={() => setPayment(true)}><Wallet />Record payment</button>
          <button className="btn primary" onClick={() => setWizard(true)}><Plus />Add loan</button>
        </div>
      </div>
      <ThisMonth />
      <div className="grid g4">{visible.map((id) => widgets[id]).filter(Boolean)}</div>
      {wizard && <LoanWizard onClose={() => setWizard(false)} />}
      {reminder && <CustomReminderForm initial={reminder} onClose={() => setReminder(null)} />}
      {payment && <PaymentForm loanId={loanId || undefined} onClose={() => setPayment(false)} />}
      {customize && <CustomizeWidgets onClose={() => setCustomize(false)} onSave={(w) => savePrefs({ ...prefs, dashboardWidgets: w })} />}
    </div>
  );
}

/** EMIs, chit installments and bills due this month, linking to Monthly expenses. */
function ThisMonth() {
  const { data, comps, asOf, fmt } = useStore();
  const { go } = useRouter();
  const m = useMemo(() => monthlyExpenses({ loans: data.loans, comps, bills: data.bills, billPayments: data.billPayments, month: asOf.slice(0, 7), asOf }), [data, comps, asOf]);
  if (!m.items.length) return null;
  return (
    <button className="card tight row between wrap" style={{ width: '100%', marginBottom: 14, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }} onClick={() => go('/expenses')}>
      <div><div className="stat-label">This month ({fmt.month(asOf.slice(0, 7))})</div><div className="stat-value"><Money v={m.totals.all.expected} /></div></div>
      <div className="row wrap small" style={{ gap: 18 }}>
        <span>EMIs <b><Money v={m.totals.loan.expected} /></b></span><span>Chits <b><Money v={m.totals.chit.expected} /></b></span><span>Bills <b><Money v={m.totals.bill.expected} /></b></span>
        <span className="pos">Paid <b><Money v={m.totals.all.paid} /></b></span><span className={+m.totals.all.remaining > 0 ? 'warn' : ''}>Left <b><Money v={m.totals.all.remaining} /></b></span>
      </div>
    </button>
  );
}

function MiniCount({ label, n, tone }: { label: string; n: number; tone?: 'neg' | 'warn' }) {
  return <div className="card tight" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}><div className="stat-label">{label}</div><div className={`stat-value ${n ? tone ?? '' : ''}`}>{n}</div></div>;
}

function Legend({ items }: { items: [string, string, string][] }) {
  return (
    <div className="col" style={{ gap: 4, marginTop: 8 }}>
      {items.map(([color, label, v]) => <div key={label} className="row between small"><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: color }} />{label}</span><Money v={v} /></div>)}
    </div>
  );
}

export function ClosureTimeline({ loanIds }: { loanIds: string[] }) {
  const { data, comps, asOf, fmt } = useStore();
  const { go } = useRouter();
  const loans = data.loans.filter((l) => loanIds.includes(l.id));
  if (!loans.length) return <p className="muted">No active loans.</p>;
  const start = loans.reduce((m, l) => (l.startDate < m ? l.startDate : m), asOf);
  const end = loans.reduce((m, l) => { const d = comps.get(l.id)?.summary.closureDate ?? asOf; return d > m ? d : m; }, asOf);
  const span = Math.max(1, Date.parse(end) - Date.parse(start));
  const pos = (d: string) => `${((Date.parse(d) - Date.parse(start)) / span) * 100}%`;
  const years: number[] = [];
  for (let y = parts(start)[0] + 1; y <= parts(end)[0]; y++) years.push(y);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ position: 'relative', height: 16 }}>
        {years.filter((_, i) => years.length < 14 || i % 2 === 0).map((y) => <span key={y} className="tiny faint" style={{ position: 'absolute', left: pos(`${y}-01-01`), transform: 'translateX(-50%)' }}>{y}</span>)}
      </div>
      {loans.map((l) => {
        const s = comps.get(l.id)!.summary;
        const close = s.closureDate ?? end;
        return (
          <button key={l.id} onClick={() => go(`/loans/${l.id}`)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} aria-label={`${l.name} closes ${fmt.date(s.closureDate)}`}>
            <div className="row between small" style={{ marginBottom: 4 }}><span>{l.name}</span><span className="muted">{s.closureDate ? fmt.date(s.closureDate) : 'Does not close at current EMI'}{s.periodsSaved > 0 && <span className="pos"> · {s.periodsSaved} installments early</span>}</span></div>
            <div style={{ position: 'relative', height: 10, background: 'var(--surface-2)', borderRadius: 6 }}>
              <div style={{ position: 'absolute', left: pos(l.startDate), width: `calc(${pos(asOf)} - ${pos(l.startDate)})`, height: '100%', background: l.color, borderRadius: 6 }} />
              <div style={{ position: 'absolute', left: pos(asOf), width: `calc(${pos(close)} - ${pos(asOf)})`, height: '100%', background: `repeating-linear-gradient(90deg, ${l.color}66 0 6px, transparent 6px 9px)`, borderRadius: 6 }} />
              <div style={{ position: 'absolute', left: pos(asOf), top: -3, bottom: -3, width: 2, background: 'var(--text)', opacity: 0.6 }} title="Today" />
            </div>
          </button>
        );
      })}
      <div className="row tiny faint" style={{ gap: 14 }}><span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: 'var(--accent)' }} />Elapsed</span><span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: 'repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 5px)' }} />Projected</span><span>│ Today</span></div>
    </div>
  );
}

export function UpcomingList({ days, loanId }: { days: number; loanId?: string }) {
  const { data, comps, asOf, fmt } = useStore();
  const { go } = useRouter();
  const until = addDays(asOf, days);
  const items = data.loans.filter((l) => l.status === 'active' && (!loanId || l.id === loanId)).flatMap((l) =>
    (comps.get(l.id)?.rows ?? []).filter((r) => r.dueDate >= asOf && r.dueDate <= until && r.status !== 'cancelled' && r.status !== 'moratorium').map((r) => ({ l, r })))
    .sort((a, b) => a.r.dueDate.localeCompare(b.r.dueDate));
  if (!items.length) return <p className="muted">Nothing scheduled in the next {days} days.</p>;
  return (
    <div className="col" style={{ gap: 2 }}>
      {items.slice(0, 10).map(({ l, r }) => (
        <button key={`${l.id}-${r.no}`} className="row between" style={{ border: 0, background: 'none', padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => go(`/loans/${l.id}`)}>
          <span className="row" style={{ gap: 8 }}>
            <span className="col" style={{ gap: 0, width: 38, textAlign: 'center' }}><b>{r.dueDate.slice(8)}</b><span className="tiny faint">{fmt.month(r.dueDate.slice(0, 7)).slice(0, 3)}</span></span>
            <span className="col" style={{ gap: 0, textAlign: 'left' }}><span>{l.name}</span><Status s={r.status} /></span>
          </span>
          <Money v={+r.shortfall > 0 ? r.shortfall : r.scheduledAmount} />
        </button>
      ))}
    </div>
  );
}

function MiniHeatmap({ portfolio, loanId }: { portfolio: Portfolio; loanId: string }) {
  const { asOf, prefs, fmt } = useStore();
  const { go } = useRouter();
  const from = addDays(addMonths(asOf, -12), 1);
  const cells = useMemo(() => dailyCells(portfolio, from, asOf, asOf, { loanIds: loanId ? [loanId] : null }), [portfolio, from, asOf, loanId]);
  return (
    <div className="col">
      <DailyHeatmap cells={cells} from={from} to={asOf} asOf={asOf} thresholds={prefs.heatmapThresholds} palette={PALETTES[prefs.heatmapPalette]} metric="amount" mode="intensity"
        weekStart={prefs.weekStart} selected={null} onSelect={(c) => go(`/heatmaps?date=${c.date}`)}
        describe={(c) => <div><b>{fmt.date(c.date)}</b><div>{c.count ? `${fmt.money(c.amount)} · ${c.count} payment(s)` : c.hasData ? 'No payments' : 'No data (before tracking)'}</div></div>} />
      <IntensityLegend palette={PALETTES[prefs.heatmapPalette]} thresholds={prefs.heatmapThresholds} format={fmt.compact} />
    </div>
  );
}

function CustomizeWidgets({ onClose, onSave }: { onClose: () => void; onSave: (w: { id: string; visible: boolean }[]) => Promise<void> }) {
  const { prefs } = useStore();
  const known = new Set(prefs.dashboardWidgets.map((w) => w.id));
  const [w, setW] = useState([...prefs.dashboardWidgets, ...DASHBOARD_WIDGETS.filter((d) => !known.has(d.id)).map((d) => ({ id: d.id, visible: true }))]);
  const label = (id: string) => DASHBOARD_WIDGETS.find((d) => d.id === id)?.label ?? id;
  const move = (i: number, d: number) => setW((xs) => { const ys = [...xs]; const [x] = ys.splice(i, 1); ys.splice(i + d, 0, x); return ys; });
  return (
    <Modal title="Customize dashboard" sub="Show, hide and reorder widgets" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { await onSave(w); onClose(); }}>Save layout</button></>}>
      <div className="col" style={{ gap: 4 }}>
        {w.map((x, i) => (
          <div key={x.id} className="row between" style={{ padding: '6px 8px', borderRadius: 8, background: 'var(--surface-2)' }}>
            <Check checked={x.visible} onChange={(v) => setW((xs) => xs.map((y) => (y.id === x.id ? { ...y, visible: v } : y)))} label={label(x.id)} />
            <span className="row" style={{ gap: 2 }}>
              <button className="btn ghost icon sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(x.id)} up`}><ArrowUp size={14} /></button>
              <button className="btn ghost icon sm" disabled={i === w.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(x.id)} down`}><ArrowDown size={14} /></button>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
