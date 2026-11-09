import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Bell, CalendarDays, CreditCard, DatabaseBackup, Flame, HelpCircle, Landmark, LayoutDashboard, LineChart, ListOrdered,
  HandCoins, PieChart, Receipt, Search, Settings as SettingsIcon, Wallet, ShieldCheck,
} from 'lucide-react';
import { useRouter } from './lib/router';
import { useStore } from './lib/store';
import { Toasts } from './components/ui';
import { Palette } from './components/Palette';
import { Dashboard } from './pages/Dashboard';
import { Loans } from './pages/Loans';
import { LoanDetail } from './pages/LoanDetail';
import { Payments } from './pages/Payments';
import { Expenses } from './pages/Expenses';
import { Bills } from './pages/Bills';
import { Lending } from './pages/Lending';
import { Heatmaps } from './pages/Heatmaps';
import { Calendar } from './pages/Calendar';
import { Schedules } from './pages/Schedules';
import { Forecast } from './pages/Forecast';
import { Reminders } from './pages/Reminders';
import { Reports } from './pages/Reports';
import { Backup } from './pages/Backup';
import { Settings } from './pages/Settings';
import { Help } from './pages/Help';

const NAV = [
  { group: 'Overview', items: [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/loans', label: 'All Loans', icon: Landmark },
    { path: '/loan', label: 'Loan Details', icon: CreditCard },
    { path: '/payments', label: 'Payment Tracker', icon: Wallet },
    { path: '/expenses', label: 'Monthly Expenses', icon: PieChart },
    { path: '/bills', label: 'Bills', icon: Receipt },
    { path: '/lending', label: 'Lending & Borrowing', icon: HandCoins },
  ] },
  { group: 'Analyse', items: [
    { path: '/heatmaps', label: 'Repayment Heatmaps', icon: Flame },
    { path: '/calendar', label: 'Calendar', icon: CalendarDays },
    { path: '/schedules', label: 'Amortization', icon: ListOrdered },
    { path: '/forecast', label: 'Forecasts & What-if', icon: LineChart },
    { path: '/reports', label: 'Reports & Analytics', icon: BarChart3 },
  ] },
  { group: 'Manage', items: [
    { path: '/reminders', label: 'Reminders', icon: Bell },
    { path: '/backup', label: 'Backup, Sync & Restore', icon: DatabaseBackup },
    { path: '/settings', label: 'Settings', icon: SettingsIcon },
    { path: '/help', label: 'Help & Diagnostics', icon: HelpCircle },
  ] },
];

export function App() {
  const { route, go } = useRouter();
  const { data, comps, inbox, asOf } = useStore();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    const off = window.emi.on('navigate', (r) => go(String(r)));
    return () => { window.removeEventListener('keydown', onKey); off(); };
  }, [go]);

  const overdue = useMemo(() => {
    let n = 0;
    for (const l of data.loans) if (l.status === 'active') n += comps.get(l.id)?.summary.overdueCount ?? 0;
    return n;
  }, [data.loans, comps]);

  const [first, second] = route.parts;
  const page = (() => {
    switch (first) {
      case undefined: return <Dashboard />;
      case 'loans': return second ? <LoanDetail id={second} /> : <Loans />;
      case 'loan': return <LoanDetail id={data.loans.find((l) => l.status === 'active')?.id ?? data.loans[0]?.id ?? ''} />;
      case 'payments': return <Payments />;
      case 'expenses': return <Expenses />;
      case 'bills': return <Bills />;
      case 'lending': return <Lending />;
      case 'heatmaps': return <Heatmaps />;
      case 'calendar': return <Calendar />;
      case 'schedules': return <Schedules />;
      case 'forecast': return <Forecast />;
      case 'reminders': return <Reminders />;
      case 'reports': return <Reports />;
      case 'backup': return <Backup />;
      case 'settings': return <Settings />;
      case 'help': return <Help />;
      default: return <Dashboard />;
    }
  })();
  const activePath = first === 'loans' && second ? '/loan' : `/${first ?? ''}`;

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark"><Landmark size={16} /></div>
          <div><div className="brand-name">EMI Tracker</div><div className="brand-sub">Private loan ledger</div></div>
        </div>
        <nav>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((it) => (
                <button key={it.path} className={`nav-item ${activePath === it.path ? 'active' : ''}`} aria-current={activePath === it.path ? 'page' : undefined}
                  onClick={() => go(it.path)}>
                  <it.icon />{it.label}
                  {it.path === '/payments' && overdue > 0 && <span className="nav-badge" title={`${overdue} overdue installment(s)`}>{overdue}</span>}
                  {it.path === '/reminders' && inbox.length > 0 && <span className="nav-badge" style={{ background: 'color-mix(in srgb, var(--info) 18%, transparent)', color: 'var(--info)' }}>{inbox.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" style={{ padding: '6px 0' }} onClick={() => go('/help')} title="All data stays on this device">
            <span className="local-chip"><span className="dot" /><ShieldCheck size={14} /> Offline · stored locally</span>
          </button>
          <div className="tiny faint" style={{ marginTop: 4 }}>As of {asOf} · v{data.app.version}</div>
        </div>
      </aside>
      <div className="titlebar">
        <button className="search" onClick={() => setPalette(true)} aria-label="Search loans, payments and pages (Ctrl+K)">
          <Search size={14} /> <span>Search loans, lenders, payments, references…</span><kbd>Ctrl K</kbd>
        </button>
      </div>
      <main className="main" id="main">{page}</main>
      {palette && <Palette onClose={() => setPalette(false)} pages={NAV.flatMap((g) => g.items)} />}
      <Toasts />
    </div>
  );
}
