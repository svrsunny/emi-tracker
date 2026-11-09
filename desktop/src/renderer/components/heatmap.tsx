import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { intensity, monthMetricValue, type CalendarState, type DayCell, type MonthCell, type MonthMetric } from '../../shared/aggregate';
import { addDays, parts, toDays, weekday, type ISODate } from '../../shared/dates';
import { MONTH_NAMES } from '../../shared/format';
import type { Preferences } from '../../shared/types';

export const PALETTES: Record<Preferences['heatmapPalette'], string[]> = {
  emerald: ['#0e4429', '#006d32', '#26a641', '#39d353'],
  blue: ['#0c2d6b', '#1550b8', '#2f7bf5', '#7cb3ff'],
  violet: ['#2e1a5c', '#4c2a9c', '#7c4ddb', '#b39bff'],
  amber: ['#4a2f05', '#8a5a0b', '#d4911b', '#f8c45c'],
  rose: ['#4c0f1f', '#8c1c3a', '#d33a63', '#ff8fab'],
};

export const STATE_COLORS: Record<CalendarState, string> = {
  none: 'var(--heat-0)', no_data: 'var(--heat-0)', paid: 'var(--positive)', partial: 'var(--warning)', upcoming: 'color-mix(in srgb, var(--text-3) 55%, transparent)',
  due: 'var(--info)', overdue: 'var(--danger)', missed: '#b5179e', prepaid: 'var(--violet)', extra: 'var(--accent)', waived: 'var(--text-3)',
};
export const STATE_LABELS: Record<CalendarState, string> = {
  none: 'No activity', no_data: 'No data (before tracking)', paid: 'Paid', partial: 'Partially paid', upcoming: 'Upcoming', due: 'Due',
  overdue: 'Overdue', missed: 'Missed', prepaid: 'Prepaid', extra: 'Extra / prepayment', waived: 'Waived',
};

export type DayMetric = 'amount' | 'principal' | 'interest' | 'count';

function dayValue(c: DayCell, m: DayMetric): number {
  return m === 'count' ? c.count : +c[m];
}

interface TipState { x: number; y: number; content: ReactNode }

export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const node = tip ? <div className="tooltip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 310), top: tip.y + 14 }}>{tip.content}</div> : null;
  return { node, show: (el: HTMLElement, content: ReactNode) => { const r = el.getBoundingClientRect(); setTip({ x: r.left, y: r.bottom - 6, content }); }, hide: () => setTip(null) };
}

/** GitHub-style daily grid. mode 'intensity' colors by amount; 'calendar' colors by EMI state. */
export function DailyHeatmap({ cells, from, to, asOf, thresholds, palette, metric, mode, weekStart, selected, onSelect, describe }: {
  cells: Map<ISODate, DayCell>; from: ISODate; to: ISODate; asOf: ISODate; thresholds: number[]; palette: string[]; metric: DayMetric;
  mode: 'intensity' | 'calendar'; weekStart: 0 | 1; selected: ISODate | null; onSelect: (c: DayCell) => void; describe: (c: DayCell) => ReactNode;
}) {
  const tip = useTooltip();
  const gridRef = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => {
    const start = addDays(from, -((weekday(from) - weekStart + 7) % 7));
    const out: ISODate[][] = [];
    for (let d = start; d <= to; d = addDays(d, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    return out;
  }, [from, to, weekStart]);
  const [focus, setFocus] = useState<ISODate>(selected ?? (asOf <= to && asOf >= from ? asOf : to));

  const color = (c: DayCell) => {
    if (mode === 'calendar') return c.state === 'no_data' ? undefined : STATE_COLORS[c.state];
    const lvl = intensity(dayValue(c, metric), thresholds);
    return lvl ? palette[lvl - 1] : undefined;
  };

  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -(toDays(focus) - toDays(from)), End: toDays(to) - toDays(focus) };
    if (e.key in step) {
      e.preventDefault();
      const next = addDays(focus, step[e.key]);
      if (next < from || next > to) return;
      setFocus(next);
      requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const c = cells.get(focus);
      if (c) onSelect(c);
    }
  };

  const dows = weekStart === 1 ? ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'] : ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 0 }}>
        <div className="heat-dow" style={{ marginTop: 17 }} aria-hidden>{dows.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div>
          <div className="heat" style={{ gridTemplateRows: '14px' }} aria-hidden>
            {weeks.map((w, i) => {
              const first = w.find((d) => d.endsWith('-01') || (i === 0 && d >= from));
              const show = first && (first.endsWith('-01') || i === 0);
              return <div key={i} className="heat-month" style={{ width: 14 }}>{show ? MONTH_NAMES[parts(first!)[1] - 1] : ''}</div>;
            })}
          </div>
          <div className="heat" ref={gridRef} role="grid" aria-label="Daily repayment heatmap. Use arrow keys to move between days and Enter to open." onKeyDown={onKey}>
            {weeks.map((w, wi) => (
              <div key={wi} role="row" style={{ display: 'grid', gridTemplateRows: 'repeat(7, 14px)', gap: 3 }}>
                {w.map((d) => {
                  const c = cells.get(d);
                  if (!c) return <span key={d} style={{ width: 14, height: 14 }} />;
                  const noData = !c.hasData && c.count === 0 && (mode === 'intensity' ? d <= asOf : c.state === 'no_data');
                  const bg = noData ? undefined : color(c);
                  return (
                    <button key={d} data-date={d} role="gridcell" tabIndex={d === focus ? 0 : -1} aria-selected={selected === d}
                      className={`heat-cell ${noData ? 'nodata' : ''} ${d > asOf ? 'future' : ''} ${selected === d ? 'sel' : ''}`}
                      style={bg ? { background: bg } : undefined}
                      aria-label={ariaDay(c, noData)}
                      onMouseEnter={(e) => tip.show(e.currentTarget, describe(c))} onMouseLeave={tip.hide}
                      onFocus={(e) => { setFocus(d); tip.show(e.currentTarget, describe(c)); }} onBlur={tip.hide}
                      onClick={() => { setFocus(d); onSelect(c); }} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {tip.node}
    </div>
  );
}

function ariaDay(c: DayCell, noData: boolean): string {
  if (noData) return `${c.date}: no data recorded (before tracking)`;
  const sched = c.scheduled.length ? `, ${c.scheduled.length} installment(s) ${c.scheduled.map((s) => s.status.replace('_', ' ')).join(', ')}` : '';
  return `${c.date}: ${c.count} payment(s) totalling ${c.amount}${sched}`;
}

export function IntensityLegend({ palette, thresholds, format }: { palette: string[]; thresholds: number[]; format: (n: number) => string }) {
  return (
    <div className="heat-legend" aria-label="Legend">
      <span className="row" style={{ gap: 4 }}><i style={{ background: 'var(--nodata)' }} />No data</span>
      <span style={{ width: 10 }} />
      <span>0</span>
      <i style={{ background: 'var(--heat-0)' }} title="No payment" />
      {palette.map((c, i) => <i key={c} style={{ background: c }} title={`≥ ${format(thresholds[i] || 0.01)}`} />)}
      <span>{format(thresholds[3])}+</span>
    </div>
  );
}

export function StateLegend() {
  const show: CalendarState[] = ['paid', 'prepaid', 'extra', 'partial', 'due', 'upcoming', 'overdue', 'missed', 'waived'];
  return (
    <div className="row wrap" style={{ gap: 12 }} aria-label="Legend">
      {show.map((s) => <span key={s} className="heat-legend"><i style={{ background: STATE_COLORS[s] }} />{STATE_LABELS[s]}</span>)}
      <span className="heat-legend"><i style={{ background: 'var(--nodata)' }} />No data</span>
    </div>
  );
}

/** Years x months grid. */
export function MonthlyHeatmap({ cells, metric, thresholds, palette, selected, onSelect, format }: {
  cells: Map<string, MonthCell>; metric: MonthMetric; thresholds: number[]; palette: string[]; selected: string | null; onSelect: (c: MonthCell) => void;
  format: (c: MonthCell) => string;
}) {
  const tip = useTooltip();
  const years = useMemo(() => [...new Set([...cells.keys()].map((k) => +k.slice(0, 4)))].sort(), [cells]);
  const color = (c: MonthCell) => {
    if (metric === 'completion') {
      if (c.completionPct === null) return undefined;
      return c.completionPct >= 100 ? palette[3] : c.completionPct >= 75 ? palette[2] : c.completionPct >= 50 ? palette[1] : c.completionPct > 0 ? palette[0] : 'color-mix(in srgb, var(--danger) 45%, transparent)';
    }
    if (metric === 'missed') return c.missedOrOverdue ? `color-mix(in srgb, var(--danger) ${Math.min(100, 35 + c.missedOrOverdue * 20)}%, transparent)` : undefined;
    const lvl = intensity(monthMetricValue(c, metric), metric === 'installments' ? [0, 1, 2, 4] : thresholds);
    return lvl ? palette[lvl - 1] : undefined;
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="mheat" style={{ gridTemplateColumns: `48px repeat(12, minmax(46px, 1fr))` }} role="grid" aria-label="Monthly repayment heatmap">
        <span />
        {MONTH_NAMES.map((m) => <span key={m} className="tiny faint" style={{ textAlign: 'center' }}>{m}</span>)}
        {years.map((y) => (
          <div key={y} role="row" style={{ display: 'contents' }}>
            <span className="small muted" style={{ alignSelf: 'center' }}>{y}</span>
            {Array.from({ length: 12 }, (_, i) => {
              const key = `${y}-${String(i + 1).padStart(2, '0')}`;
              const c = cells.get(key);
              if (!c) return <span key={key} />;
              const noData = !c.hasData;
              const bg = noData ? undefined : color(c);
              return (
                <button key={key} role="gridcell" className={`mheat-cell ${noData ? 'nodata' : ''} ${selected === key ? 'sel' : ''}`} style={bg ? { background: bg } : undefined}
                  aria-label={`${MONTH_NAMES[i]} ${y}: ${noData ? 'no data' : format(c)}`}
                  onMouseEnter={(e) => tip.show(e.currentTarget, <MonthTip c={c} format={format} />)} onMouseLeave={tip.hide}
                  onFocus={(e) => tip.show(e.currentTarget, <MonthTip c={c} format={format} />)} onBlur={tip.hide} onClick={() => onSelect(c)}>
                  {noData ? '' : shortValue(c, metric)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {tip.node}
    </div>
  );
}

function shortValue(c: MonthCell, metric: MonthMetric): string {
  switch (metric) {
    case 'installments': return c.installmentsPaid ? String(c.installmentsPaid) : '';
    case 'missed': return c.missedOrOverdue ? String(c.missedOrOverdue) : '';
    case 'completion': return c.completionPct === null ? '' : `${c.completionPct}%`;
    default: {
      const v = monthMetricValue(c, metric);
      if (!v) return '';
      return v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v));
    }
  }
}

function MonthTip({ c, format }: { c: MonthCell; format: (c: MonthCell) => string }) {
  const [y, m] = c.month.split('-').map(Number);
  return (
    <div className="col" style={{ gap: 2 }}>
      <b>{MONTH_NAMES[m - 1]} {y}</b>
      {!c.hasData ? <span className="faint">No data recorded for this month</span> : <span>{format(c)}</span>}
      {c.hasData && <span className="faint small">{c.count} payment(s) · {c.installmentsPaid}/{c.scheduledCount} installments paid{c.missedOrOverdue ? ` · ${c.missedOrOverdue} overdue/missed` : ''}</span>}
    </div>
  );
}
