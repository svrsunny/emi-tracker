import { useEffect, useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { MonthSeries } from '../../shared/aggregate';
import { useStore } from '../lib/store';

/** Resolved theme colors (SVG attributes need concrete values). */
export function useColors() {
  const { prefs } = useStore();
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      accent: v('--accent') || prefs.accent, positive: v('--positive'), warning: v('--warning'), danger: v('--danger'), info: v('--info'),
      violet: v('--violet'), text3: v('--text-3'), grid: v('--grid'), surface3: v('--surface-3'), line: v('--line-2'),
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const t = setTimeout(() => setC(read()), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.theme, prefs.accent]);
  return c;
}

export function ChartTip({ title, rows }: { title: ReactNode; rows: { color?: string; label: string; value: ReactNode }[] }) {
  return (
    <div className="chart-tip">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label} style={{ justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 6 }}>{r.color && <span className="swatch" style={{ background: r.color }} />}<span className="muted">{r.label}</span></span>
          <span className="money">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const axis = { tickLine: false, axisLine: false } as const;

export function Donut({ data, center, height = 210 }: { data: { name: string; value: number; color: string }[]; center?: ReactNode; height?: number }) {
  const { fmt } = useStore();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ position: 'relative', height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={total ? data : [{ name: 'None', value: 1, color: 'transparent' }]} dataKey="value" innerRadius="68%" outerRadius="92%" paddingAngle={total ? 1.5 : 0} stroke="none" isAnimationActive={false}>
            {(total ? data : [{ color: 'rgba(128,128,128,.15)' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          {total > 0 && <Tooltip content={({ payload }) => payload?.[0] ? <ChartTip title={payload[0].name} rows={[{ label: 'Amount', value: fmt.money(payload[0].value as number) }, { label: 'Share', value: `${((+(payload[0].value ?? 0) / total) * 100).toFixed(1)}%` }]} /> : null} />}
        </PieChart>
      </ResponsiveContainer>
      {center && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>{center}</div>}
    </div>
  );
}

export function MonthlyPaymentsChart({ data, onMonth, height = 260 }: { data: MonthSeries[]; onMonth?: (month: string) => void; height?: number }) {
  const c = useColors();
  const { fmt } = useStore();
  return (
    <ResponsiveContainer height={height}>
      <BarChart data={data} onClick={(e) => { const m = (e as { activeLabel?: string } | null)?.activeLabel; if (m && onMonth) onMonth(m); }} style={{ cursor: onMonth ? 'pointer' : undefined }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" {...axis} tickFormatter={fmt.month} minTickGap={16} />
        <YAxis {...axis} tickFormatter={(v) => fmt.compact(v)} width={64} />
        <Tooltip cursor={{ fill: c.grid }} content={({ payload, label }) => payload?.length ? <ChartTip title={fmt.month(String(label))} rows={[
          { color: c.accent, label: 'Principal', value: fmt.money(payload[0]?.payload.principal) },
          { color: c.warning, label: 'Interest', value: fmt.money(payload[0]?.payload.interest) },
          { color: c.danger, label: 'Fees & penalties', value: fmt.money(payload[0]?.payload.fees) },
          { label: 'Total paid', value: fmt.money(payload[0]?.payload.paid) },
        ]} /> : null} />
        <Legend iconType="circle" iconSize={8} />
        <Bar dataKey="principal" name="Principal" stackId="a" fill={c.accent} isAnimationActive={false} />
        <Bar dataKey="interest" name="Interest" stackId="a" fill={c.warning} isAnimationActive={false} />
        <Bar dataKey="fees" name="Fees & penalties" stackId="a" fill={c.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ActualVsScheduledChart({ data, height = 260 }: { data: MonthSeries[]; height?: number }) {
  const c = useColors();
  const { fmt } = useStore();
  return (
    <ResponsiveContainer height={height}>
      <ComposedChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" {...axis} tickFormatter={fmt.month} minTickGap={16} />
        <YAxis {...axis} tickFormatter={(v) => fmt.compact(v)} width={64} />
        <Tooltip cursor={{ fill: c.grid }} content={({ payload, label }) => payload?.length ? <ChartTip title={fmt.month(String(label))} rows={[
          { color: c.accent, label: 'Actually paid', value: fmt.money(payload[0]?.payload.paid) },
          { color: c.text3, label: 'Scheduled (due)', value: fmt.money(payload[0]?.payload.scheduled) },
          { color: c.info, label: 'Projected', value: fmt.money(payload[0]?.payload.projected) },
        ]} /> : null} />
        <Legend iconType="circle" iconSize={8} />
        <Bar dataKey="paid" name="Actually paid" fill={c.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="projected" name="Projected" fill={c.info} fillOpacity={0.35} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Line dataKey="scheduled" name="Scheduled" stroke={c.text3} strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function InterestTrendChart({ data, height = 240 }: { data: MonthSeries[]; height?: number }) {
  const c = useColors();
  const { fmt } = useStore();
  let cum = 0;
  const rows = data.filter((d) => d.paid > 0).map((d) => { cum += d.interest; return { month: d.month, interest: d.interest, cumulative: Math.round(cum * 100) / 100 }; });
  return (
    <ResponsiveContainer height={height}>
      <AreaChart data={rows}>
        <defs>
          <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.warning} stopOpacity={0.35} /><stop offset="100%" stopColor={c.warning} stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" {...axis} tickFormatter={fmt.month} minTickGap={16} />
        <YAxis {...axis} tickFormatter={(v) => fmt.compact(v)} width={64} />
        <Tooltip content={({ payload, label }) => payload?.length ? <ChartTip title={fmt.month(String(label))} rows={[
          { color: c.warning, label: 'Interest this month', value: fmt.money(payload[0]?.payload.interest) },
          { label: 'Cumulative interest', value: fmt.money(payload[0]?.payload.cumulative) },
        ]} /> : null} />
        <Area dataKey="cumulative" stroke={c.warning} fill="url(#gi)" strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function YearBars({ data, height = 220 }: { data: { year: number; principal: string; interest: string; fees: string; paid: string }[]; height?: number }) {
  const c = useColors();
  const { fmt } = useStore();
  const rows = data.map((d) => ({ year: String(d.year), principal: +d.principal, interest: +d.interest, fees: +d.fees, paid: +d.paid }));
  return (
    <ResponsiveContainer height={height}>
      <BarChart data={rows}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="year" {...axis} />
        <YAxis {...axis} tickFormatter={(v) => fmt.compact(v)} width={64} />
        <Tooltip cursor={{ fill: c.grid }} content={({ payload, label }) => payload?.length ? <ChartTip title={String(label)} rows={[
          { color: c.accent, label: 'Principal', value: fmt.money(payload[0]?.payload.principal) },
          { color: c.warning, label: 'Interest', value: fmt.money(payload[0]?.payload.interest) },
          { color: c.danger, label: 'Fees', value: fmt.money(payload[0]?.payload.fees) },
          { label: 'Total', value: fmt.money(payload[0]?.payload.paid) },
        ]} /> : null} />
        <Bar dataKey="principal" stackId="a" fill={c.accent} isAnimationActive={false} />
        <Bar dataKey="interest" stackId="a" fill={c.warning} isAnimationActive={false} />
        <Bar dataKey="fees" stackId="a" fill={c.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ rows, height = 260, compare }: { rows: { dueDate: string; closingPrincipal: string; isProjected: boolean }[]; height?: number; compare?: { dueDate: string; closingPrincipal: string }[] }) {
  const c = useColors();
  const { fmt } = useStore();
  const map = new Map<string, { date: string; actual?: number; projected?: number; compare?: number }>();
  let lastActual: string | null = null;
  for (const r of rows) {
    const e = map.get(r.dueDate) ?? { date: r.dueDate };
    if (r.isProjected) e.projected = +r.closingPrincipal; else { e.actual = +r.closingPrincipal; lastActual = r.dueDate; }
    map.set(r.dueDate, e);
  }
  if (lastActual) { const e = map.get(lastActual)!; e.projected = e.actual; }
  for (const r of compare ?? []) { const e = map.get(r.dueDate) ?? { date: r.dueDate }; e.compare = +r.closingPrincipal; map.set(r.dueDate, e); }
  const data = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ResponsiveContainer height={height}>
      <AreaChart data={data}>
        <defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.accent} stopOpacity={0.3} /><stop offset="100%" stopColor={c.accent} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d) => fmt.month(String(d).slice(0, 7))} minTickGap={30} />
        <YAxis {...axis} tickFormatter={(v) => fmt.compact(v)} width={64} />
        <Tooltip content={({ payload, label }) => payload?.length ? <ChartTip title={fmt.date(String(label))} rows={payload.filter((p) => p.value !== undefined).map((p) => ({ color: p.color, label: String(p.name), value: fmt.money(p.value as number) }))} /> : null} />
        <Legend iconType="circle" iconSize={8} />
        <Area dataKey="actual" name="Outstanding (actual)" stroke={c.accent} fill="url(#gb)" strokeWidth={2} connectNulls isAnimationActive={false} />
        <Area dataKey="projected" name="Projected" stroke={c.info} strokeDasharray="5 4" fill="none" strokeWidth={1.5} connectNulls isAnimationActive={false} />
        {compare && <Area dataKey="compare" name="Scenario" stroke={c.positive} fill="none" strokeWidth={1.5} connectNulls isAnimationActive={false} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}
