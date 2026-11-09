import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  autoThresholds, dailyCells, intensity, loanMonthMatrix, monthlyCells, monthMetricValue, type DayCell, type MonthCell, type MonthMetric, type Portfolio,
} from '../../shared/aggregate';
import { addDays, fmtISO, isoWeekKey, parts } from '../../shared/dates';
import { MONTH_NAMES } from '../../shared/format';
import type { Preferences } from '../../shared/types';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { DailyHeatmap, IntensityLegend, MonthlyHeatmap, PALETTES, STATE_COLORS, STATE_LABELS, StateLegend, useTooltip, type DayMetric } from '../components/heatmap';
import { BtnGroup, Card, Callout, Kv, Money, PAYMENT_TYPE_LABEL, Status } from '../components/ui';
import { LoanFilter } from './Dashboard';

type Mode = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'loans' | 'calendar';

export function Heatmaps() {
  const { data, comps, asOf, prefs, fmt, savePrefs } = useStore();
  const { route, go } = useRouter();
  const [mode, setMode] = useState<Mode>((route.query.get('mode') as Mode) || 'daily');
  const [loanId, setLoanId] = useState('');
  const currentYear = parts(asOf)[0];
  const years = useMemo(() => {
    const first = data.loans.reduce((m, l) => Math.min(m, parts(l.startDate)[0]), currentYear);
    const last = data.loans.reduce((m, l) => Math.max(m, parts(comps.get(l.id)?.summary.closureDate ?? asOf)[0]), currentYear);
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  }, [data.loans, comps, currentYear, asOf]);
  const [year, setYear] = useState<number | 'last12'>(route.query.get('date') ? parts(route.query.get('date')!)[0] : 'last12');
  const [dayMetric, setDayMetric] = useState<DayMetric>('amount');
  const [monthMetric, setMonthMetric] = useState<MonthMetric>('amount');
  const [autoScale, setAutoScale] = useState(false);
  const [selDay, setSelDay] = useState<DayCell | null>(null);
  const [selMonth, setSelMonth] = useState<MonthCell | null>(null);

  const portfolio: Portfolio = { loans: data.loans, comps, payments: data.payments };
  const filters = { loanIds: loanId ? [loanId] : null };
  const from = year === 'last12' ? addDays(fmtISO(currentYear - 1, parts(asOf)[1], parts(asOf)[2]), 1) : fmtISO(year, 1, 1);
  const to = year === 'last12' ? (mode === 'calendar' ? addDays(asOf, 90) : asOf) : fmtISO(year, 12, 31);
  const palette = PALETTES[prefs.heatmapPalette];

  const days = useMemo(() => dailyCells(portfolio, from, to, asOf, filters), [data, comps, from, to, asOf, loanId]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthsFrom = `${years[0]}-01`, monthsTo = `${years[years.length - 1]}-12`;
  const months = useMemo(() => monthlyCells(portfolio, monthsFrom, monthsTo, asOf, filters), [data, comps, monthsFrom, monthsTo, asOf, loanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayValues = [...days.values()].map((c) => (dayMetric === 'count' ? c.count : +c[dayMetric]));
  const thresholds = autoScale || dayMetric === 'count' ? (dayMetric === 'count' ? [0, 1, 2, 3] : autoThresholds(dayValues)) : prefs.heatmapThresholds;
  const monthThresholds = autoScale ? autoThresholds([...months.values()].map((c) => monthMetricValue(c, monthMetric))) : prefs.heatmapThresholds.map((t) => t * 4);

  const totalShown = [...days.values()].reduce((s, c) => s + +c.amount, 0);
  const daysWithPayments = [...days.values()].filter((c) => c.count > 0).length;

  const describeDay = (c: DayCell) => (
    <div className="col" style={{ gap: 2 }}>
      <b>{fmt.date(c.date)}</b>
      {!c.hasData && c.count === 0 && c.date <= asOf ? <span className="faint">No data — before tracking started</span> : (
        <>
          {c.count > 0 ? <span>{fmt.money(c.amount)} · {c.count} payment(s)</span> : <span className="faint">{c.date > asOf ? 'Future date' : 'No payments (zero activity)'}</span>}
          {c.count > 0 && <span className="faint small">Principal {fmt.money(c.principal)} · Interest {fmt.money(c.interest)}{+c.fees + +c.penalty > 0 ? ` · Fees ${fmt.money(+c.fees + +c.penalty)}` : ''}</span>}
          {c.scheduled.map((s) => <span key={`${s.loanId}-${s.no}`} className="small">{data.loans.find((l) => l.id === s.loanId)?.name}: {STATE_LABELS[stateOf(s.status)]} {fmt.money(s.amount)}</span>)}
        </>
      )}
    </div>
  );

  const monthText = (c: MonthCell) => {
    switch (monthMetric) {
      case 'installments': return `${c.installmentsPaid} installment(s) paid`;
      case 'missed': return `${c.missedOrOverdue} overdue / missed`;
      case 'completion': return c.completionPct === null ? 'Nothing scheduled' : `${c.completionPct}% of scheduled installments paid`;
      default: return fmt.money(monthMetricValue(c, monthMetric));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Repayment heatmaps</h1><p className="page-sub">What you actually paid, day by day and month by month. Hatched cells mean no data was recorded — not zero.</p></div>
        <div className="row wrap">
          <LoanFilter value={loanId} onChange={setLoanId} />
          {(mode === 'daily' || mode === 'calendar') && (
            <select className="input" style={{ width: 130, height: 30 }} value={String(year)} onChange={(e) => setYear(e.target.value === 'last12' ? 'last12' : +e.target.value)} aria-label="Period">
              <option value="last12">{mode === 'calendar' ? 'Last 12 months + next 3' : 'Last 12 months'}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="row wrap between" style={{ marginBottom: 14 }}>
        <BtnGroup label="View" value={mode} onChange={(m) => { setMode(m); setSelDay(null); setSelMonth(null); }} options={[
          { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' },
          { value: 'loans', label: 'Loan comparison' }, { value: 'calendar', label: 'Scheduled vs actual' },
        ]} />
        <div className="row wrap">
          {mode === 'daily' && <BtnGroup label="Metric" value={dayMetric} onChange={setDayMetric} options={[{ value: 'amount', label: 'Amount' }, { value: 'principal', label: 'Principal' }, { value: 'interest', label: 'Interest' }, { value: 'count', label: 'Count' }]} />}
          {(mode === 'monthly' || mode === 'loans') && (
            <select className="input" style={{ width: 210, height: 30 }} value={monthMetric} onChange={(e) => setMonthMetric(e.target.value as MonthMetric)} aria-label="Metric">
              <option value="amount">Total amount paid</option><option value="principal">Principal repaid</option><option value="interest">Interest paid</option>
              <option value="installments">Installments paid</option><option value="missed">Missed / overdue count</option><option value="completion">% of scheduled completed</option>
            </select>
          )}
          {mode !== 'calendar' && (
            <>
              <select className="input" style={{ width: 120, height: 30 }} value={prefs.heatmapPalette} onChange={(e) => void savePrefs({ ...prefs, heatmapPalette: e.target.value as Preferences['heatmapPalette'] })} aria-label="Colour palette">
                {Object.keys(PALETTES).map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
              <BtnGroup label="Scale" value={autoScale ? 'auto' : 'fixed'} onChange={(v) => setAutoScale(v === 'auto')} options={[{ value: 'fixed', label: 'My thresholds' }, { value: 'auto', label: 'Auto (quartiles)' }]} />
            </>
          )}
        </div>
      </div>

      <div className="grid g3">
        <Card className="span-all" title={mode === 'calendar' ? 'Scheduled and actual payments' : mode === 'loans' ? 'Loan comparison' : `${mode[0].toUpperCase()}${mode.slice(1)} activity`}
          sub={mode === 'daily' ? `${daysWithPayments} day(s) with payments · ${fmt.money(totalShown)} in view` : mode === 'calendar' ? 'Each cell shows the most important state of that day' : undefined}>
          {(mode === 'daily' || mode === 'calendar') && (
            <div className="col" style={{ gap: 12 }}>
              <DailyHeatmap cells={days} from={from} to={to} asOf={asOf} thresholds={thresholds} palette={palette} metric={dayMetric} mode={mode === 'calendar' ? 'calendar' : 'intensity'}
                weekStart={prefs.weekStart} selected={selDay?.date ?? null} onSelect={setSelDay} describe={describeDay} />
              {mode === 'calendar' ? <StateLegend /> : <IntensityLegend palette={palette} thresholds={thresholds} format={dayMetric === 'count' ? String : fmt.compact} />}
            </div>
          )}
          {mode === 'monthly' && (
            <div className="col" style={{ gap: 12 }}>
              <MonthlyHeatmap cells={months} metric={monthMetric} thresholds={monthThresholds} palette={palette} selected={selMonth?.month ?? null} onSelect={setSelMonth} format={monthText} />
              <IntensityLegend palette={palette} thresholds={monthThresholds} format={fmt.compact} />
            </div>
          )}
          {mode === 'weekly' && <WeeklyGrid portfolio={portfolio} filters={filters} years={years} palette={palette} thresholds={autoScale ? undefined : prefs.heatmapThresholds.map((t) => t * 1.5)} />}
          {mode === 'yearly' && <YearlyGrid months={months} palette={palette} onYear={(y) => { setYear(y); setMode('daily'); }} />}
          {mode === 'loans' && <LoanCompare portfolio={portfolio} years={years} metric={monthMetric} palette={palette} thresholds={monthThresholds} format={monthText} onSelect={(c, id) => go(`/payments?month=${c.month}&loan=${id}`)} />}
        </Card>

        <Card className="span-all" title="Details" sub={selDay ? fmt.date(selDay.date) : selMonth ? fmt.month(selMonth.month) : 'Select a cell (click, or arrow keys + Enter)'}>
          {selDay && <DayDetails c={selDay} />}
          {selMonth && (
            <div className="col">
              {!selMonth.hasData ? <Callout>No records for this month. Tracking had not started, or no data was entered — this is not the same as a missed payment.</Callout> : (
                <Kv items={[['Total paid', <Money key="a" v={selMonth.amount} />], ['Principal', <Money key="p" v={selMonth.principal} />], ['Interest', <Money key="i" v={selMonth.interest} />], ['Fees & penalties', <Money key="f" v={selMonth.fees} />],
                  ['Payments', selMonth.count], ['Installments paid', `${selMonth.installmentsPaid} of ${selMonth.scheduledCount} due`], ['Overdue / missed', selMonth.missedOrOverdue], ['Completion', selMonth.completionPct === null ? '—' : `${selMonth.completionPct}%`]]} />
              )}
              <button className="btn sm" onClick={() => go(`/payments?month=${selMonth.month}${loanId ? `&loan=${loanId}` : ''}`)}><ExternalLink />Open payment records</button>
            </div>
          )}
          {!selDay && !selMonth && (
            <div className="col small muted">
              <p style={{ margin: 0 }}>Colour intensity shows the amount actually paid. Thresholds are configurable in Settings → Heatmaps.</p>
              <p style={{ margin: 0 }}>Hatched cells are dates before any loan was tracked — they are unknown, not zero. Plain dark cells are tracked days with no payment.</p>
              <p style={{ margin: 0 }}>Past installments without a record are never shown as missed unless you mark them missed.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function stateOf(s: string) {
  const m: Record<string, keyof typeof STATE_COLORS> = { paid: 'paid', assumed_paid: 'paid', prepaid: 'prepaid', partially_paid: 'partial', overdue: 'overdue', missed: 'missed', due: 'due', upcoming: 'upcoming', waived: 'waived', unrecorded: 'no_data' };
  return m[s] ?? 'none';
}

function DayDetails({ c }: { c: DayCell }) {
  const { data, comps, fmt, asOf } = useStore();
  const { go } = useRouter();
  const pays = data.payments.filter((p) => c.paymentIds.includes(p.id));
  return (
    <div className="col">
      {!c.hasData && c.count === 0 && c.date <= asOf && <Callout>No data recorded for this date (before tracking started).</Callout>}
      {c.count > 0 && <Kv items={[['Total paid', <Money key="a" v={c.amount} />], ['Payments', c.count], ['Principal', <Money key="p" v={c.principal} />], ['Interest', <Money key="i" v={c.interest} />], ['Fees & penalties', <Money key="f" v={+c.fees + +c.penalty} />], ['Loans', c.loanIds.map((id) => data.loans.find((l) => l.id === id)?.name).join(', ')]]} />}
      {c.count === 0 && c.hasData && <p className="muted small" style={{ margin: 0 }}>No payments on this day.</p>}
      {c.scheduled.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="field-label">Installments due</div>
          {c.scheduled.map((s) => {
            const l = data.loans.find((x) => x.id === s.loanId);
            const row = comps.get(s.loanId)?.rows.find((r) => r.no === s.no);
            return <div key={`${s.loanId}-${s.no}`} className="row between small"><span>{l?.name} #{row?.emiNo ?? s.no}</span><span className="row"><Status s={s.status} /><Money v={s.amount} /></span></div>;
          })}
        </div>
      )}
      {pays.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="field-label">Transactions</div>
          {pays.map((p) => <div key={p.id} className="row between small"><span>{data.loans.find((l) => l.id === p.loanId)?.name} · {PAYMENT_TYPE_LABEL[p.type]}{p.reference ? ` · ${p.reference}` : ''}</span><Money v={p.amount} /></div>)}
        </div>
      )}
      {(pays.length > 0 || c.scheduled.length > 0) && <button className="btn sm" onClick={() => go(`/payments?date=${c.date}`)}><ExternalLink />Open in payment tracker</button>}
      <div className="tiny faint">{fmt.date(c.date)}</div>
    </div>
  );
}

function WeeklyGrid({ portfolio, filters, years, palette, thresholds }: { portfolio: Portfolio; filters: { loanIds: string[] | null }; years: number[]; palette: string[]; thresholds?: number[] }) {
  const { asOf, fmt } = useStore();
  const tip = useTooltip();
  const data = useMemo(() => {
    const cells = dailyCells(portfolio, `${years[0]}-01-01`, `${years[years.length - 1]}-12-31`, asOf, filters);
    const weeks = new Map<string, { amount: number; count: number; hasData: boolean; start: string }>();
    for (const c of cells.values()) {
      const k = isoWeekKey(c.date);
      const w = weeks.get(k) ?? { amount: 0, count: 0, hasData: false, start: c.date };
      w.amount += +c.amount; w.count += c.count; w.hasData ||= c.hasData;
      weeks.set(k, w);
    }
    return weeks;
  }, [portfolio, years, asOf, filters]);
  const th = thresholds ?? autoThresholds([...data.values()].map((w) => w.amount));
  return (
    <div className="col" style={{ gap: 6, overflowX: 'auto' }}>
      {years.map((y) => (
        <div key={y} className="row" style={{ gap: 3 }}>
          <span className="small muted" style={{ width: 40 }}>{y}</span>
          {Array.from({ length: 53 }, (_, i) => {
            const k = `${y}-W${String(i + 1).padStart(2, '0')}`;
            const w = data.get(k);
            if (!w) return <span key={k} style={{ width: 11 }} />;
            const lvl = intensity(w.amount, th);
            return <button key={k} className={`heat-cell ${!w.hasData ? 'nodata' : ''}`} style={{ width: 11, height: 22, background: w.hasData && lvl ? palette[lvl - 1] : undefined }}
              aria-label={`Week ${i + 1} of ${y}: ${w.hasData ? fmt.money(w.amount) : 'no data'}`}
              onMouseEnter={(e) => tip.show(e.currentTarget, <div><b>Week {i + 1}, {y}</b><div>from {fmt.date(w.start)}</div><div>{w.hasData ? `${fmt.money(w.amount)} · ${w.count} payment(s)` : 'No data'}</div></div>)} onMouseLeave={tip.hide} />;
          })}
        </div>
      ))}
      <IntensityLegend palette={palette} thresholds={th} format={fmt.compact} />
      {tip.node}
    </div>
  );
}

function YearlyGrid({ months, palette, onYear }: { months: Map<string, MonthCell>; palette: string[]; onYear: (y: number) => void }) {
  const { fmt } = useStore();
  const years = new Map<number, { amount: number; principal: number; interest: number; count: number; hasData: boolean }>();
  for (const c of months.values()) {
    const y = +c.month.slice(0, 4);
    const e = years.get(y) ?? { amount: 0, principal: 0, interest: 0, count: 0, hasData: false };
    e.amount += +c.amount; e.principal += +c.principal; e.interest += +c.interest; e.count += c.count; e.hasData ||= c.hasData;
    years.set(y, e);
  }
  const th = autoThresholds([...years.values()].map((v) => v.amount));
  return (
    <div className="grid g-auto">
      {[...years.entries()].map(([y, v]) => {
        const lvl = intensity(v.amount, th);
        return (
          <button key={y} className={`card tight interactive ${!v.hasData ? 'mheat-cell nodata' : ''}`} style={{ textAlign: 'left', borderLeft: `4px solid ${v.hasData && lvl ? palette[lvl - 1] : 'var(--line)'}` }} onClick={() => onYear(y)}>
            <div className="stat-label">{y}</div>
            <div className="stat-value">{v.hasData ? fmt.compact(v.amount) : '—'}</div>
            <div className="stat-foot">{v.hasData ? `${v.count} payments · interest ${fmt.compact(v.interest)}` : 'No data'}</div>
          </button>
        );
      })}
    </div>
  );
}

function LoanCompare({ portfolio, years, metric, palette, thresholds, format, onSelect }: { portfolio: Portfolio; years: number[]; metric: MonthMetric; palette: string[]; thresholds: number[]; format: (c: MonthCell) => string; onSelect: (c: MonthCell, loanId: string) => void }) {
  const { asOf } = useStore();
  const tip = useTooltip();
  const [y, setY] = useState(years.includes(parts(asOf)[0]) ? parts(asOf)[0] : years[years.length - 1]);
  const matrix = useMemo(() => loanMonthMatrix(portfolio, `${y}-01`, `${y}-12`, asOf), [portfolio, y, asOf]);
  return (
    <div className="col">
      <BtnGroup value={String(y)} onChange={(v) => setY(+v)} options={years.map((yy) => ({ value: String(yy), label: String(yy) }))} />
      <div className="mheat" style={{ gridTemplateColumns: '170px repeat(12, minmax(38px, 1fr))' }}>
        <span />
        {MONTH_NAMES.map((m) => <span key={m} className="tiny faint" style={{ textAlign: 'center' }}>{m}</span>)}
        {matrix.map(({ loan, cells }) => (
          <div key={loan.id} style={{ display: 'contents' }}>
            <span className="small row" style={{ gap: 6, overflow: 'hidden' }}><span className="swatch" style={{ background: loan.color }} />{loan.name}</span>
            {[...cells.values()].map((c) => {
              const v = monthMetricValue(c, metric);
              const lvl = metric === 'missed' ? (c.missedOrOverdue ? 4 : 0) : intensity(v, metric === 'installments' ? [0, 1, 2, 3] : metric === 'completion' ? [0, 1, 50, 100] : thresholds);
              const bg = !c.hasData ? undefined : metric === 'missed' && lvl ? 'var(--danger)' : lvl ? palette[lvl - 1] : undefined;
              return <button key={c.month} className={`mheat-cell ${!c.hasData ? 'nodata' : ''}`} style={bg ? { background: bg } : undefined} aria-label={`${loan.name} ${c.month}: ${c.hasData ? format(c) : 'no data'}`}
                onMouseEnter={(e) => tip.show(e.currentTarget, <div><b>{loan.name}</b><div>{c.month}</div><div>{c.hasData ? format(c) : 'No data'}</div></div>)} onMouseLeave={tip.hide} onClick={() => onSelect(c, loan.id)} />;
            })}
          </div>
        ))}
      </div>
      <IntensityLegend palette={palette} thresholds={thresholds} format={String} />
      {tip.node}
    </div>
  );
}
