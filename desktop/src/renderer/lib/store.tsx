/**
 * App state: the loaded records plus derived engine output. Engine results are recomputed
 * from records whenever they change, so every screen shows figures derived from the same data.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeLoan, type LoanComputation } from '../../shared/engine';
import { makeFormatters, type Formatters } from '../../shared/format';
import { wallTime } from '../../shared/reminders';
import type { NotificationRecord, Preferences } from '../../shared/types';
import { call, type LoadedData } from './api';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; title: string; body?: string }

interface Store {
  data: LoadedData;
  prefs: Preferences;
  comps: Map<string, LoanComputation>;
  asOf: string;
  fmt: Formatters;
  reload: () => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  savePrefs: (p: Preferences) => Promise<void>;
  inbox: NotificationRecord[];
}

const Ctx = createContext<Store | null>(null);
let toastSeq = 0;

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [clock, setClock] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setData(await call<LoadedData>('data:load'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq;
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4500);
  }, []);

  useEffect(() => {
    void reload();
    const offChanged = window.emi.on('data:changed', () => void reload());
    const offNote = window.emi.on('notification', (n) => {
      const rec = n as NotificationRecord;
      toast({ kind: 'info', title: rec.title, body: rec.body });
      void reload();
    });
    const t = setInterval(() => setClock(Date.now()), 60_000);
    return () => { offChanged(); offNote(); clearInterval(t); };
  }, [reload, toast]);

  const prefs = data?.preferences;
  const asOf = useMemo(() => wallTime(new Date(clock), prefs?.timeZone || undefined).slice(0, 10), [clock, prefs?.timeZone]);
  const comps = useMemo(() => {
    const m = new Map<string, LoanComputation>();
    if (!data) return m;
    for (const l of data.loans) m.set(l.id, computeLoan(l, data.adjustments, data.payments, asOf));
    return m;
  }, [data, asOf]);
  const fmt = useMemo(() => makeFormatters(prefs ?? { currency: 'INR', locale: 'en-IN', decimals: 2, dateFormat: 'DD MMM YYYY' }), [prefs]);

  // theme + accent
  useEffect(() => {
    if (!prefs) return;
    const apply = () => {
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    document.documentElement.style.setProperty('--accent', prefs.accent);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs]);

  const savePrefs = useCallback(async (p: Preferences) => {
    await call('prefs:set', p);
    await reload();
  }, [reload]);

  const inbox = useMemo(() => (data?.notifications ?? []).filter((n) => n.state === 'sent'), [data]);

  if (error) return <div className="empty"><h3>Could not load your data</h3><p>{error}</p></div>;
  if (!data || !prefs) return <>{fallback}</>;
  return (
    <Ctx.Provider value={{ data, prefs, comps, asOf, fmt, reload, toast, toasts, dismissToast: (id) => setToasts((xs) => xs.filter((x) => x.id !== id)), savePrefs, inbox }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('Store not ready');
  return s;
}

/** Run an action with toast feedback; returns undefined on failure. */
export function useAction() {
  const { toast, reload } = useStore();
  return useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      await reload();
      if (success) toast({ kind: 'success', title: success });
      return r;
    } catch (e) {
      toast({ kind: 'error', title: 'Action failed', body: (e as Error).message });
      return undefined;
    }
  }, [toast, reload]);
}
