import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { RowStatus } from '../../shared/engine';
import { useStore } from '../lib/store';

export const STATUS_LABEL: Record<RowStatus, string> = {
  upcoming: 'Upcoming', due: 'Due', paid: 'Paid', partially_paid: 'Partially paid', overdue: 'Overdue', missed: 'Missed',
  prepaid: 'Prepaid', waived: 'Waived', cancelled: 'Cancelled', unrecorded: 'No record', assumed_paid: 'Paid (assumed)', moratorium: 'Moratorium',
};

export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  emi: 'EMI', partial: 'Partial EMI', advance: 'Advance EMI', prepayment: 'Prepayment', foreclosure: 'Foreclosure', fee: 'Fee / charge',
  penalty: 'Penalty', missed: 'Missed (marker)', waiver: 'Waiver (marker)',
};

export const LOAN_TYPE_LABEL: Record<string, string> = {
  home: 'Home loan', personal: 'Personal loan', vehicle: 'Vehicle loan', education: 'Education loan', gold: 'Gold loan',
  business: 'Business loan', consumer_durable: 'Consumer durable', credit_card: 'Credit card EMI', loan_against_property: 'Loan against property', chit_fund: 'Chit fund', other: 'Other',
};

export function Status({ s }: { s: RowStatus }) {
  return <span className={`status s-${s}`}>{STATUS_LABEL[s]}</span>;
}

export function Money({ v, className = '', compact }: { v: string | number | null | undefined; className?: string; compact?: boolean }) {
  const { fmt } = useStore();
  if (v === null || v === undefined || v === '') return <span className={className}>—</span>;
  return <span className={`money ${className}`} title={compact ? fmt.money(v) : undefined}>{compact ? fmt.compact(v) : fmt.money(v)}</span>;
}

export function Estimate({ show = true, label = 'Estimate', title }: { show?: boolean; label?: string; title?: string }) {
  if (!show) return null;
  return <span className="tag est" title={title ?? 'Calculated from incomplete or assumed data. See the loan warnings.'}>{label}</span>;
}

export function Projected({ label = 'Projected' }: { label?: string }) {
  return <span className="tag proj" title="Hypothetical projection — not a recorded transaction">{label}</span>;
}

export function Card({ title, sub, actions, children, className = '', flush }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-head" style={flush ? { padding: '14px 16px 0' } : undefined}>
          <div className="grow">
            {title && <h2 className="section-title">{title}</h2>}
            {sub && <p className="section-sub">{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, foot, tone, large, tag, onClick }: { label: ReactNode; value: ReactNode; foot?: ReactNode; tone?: 'pos' | 'neg' | 'warn'; large?: boolean; tag?: ReactNode; onClick?: () => void }) {
  return (
    <div className={`card tight ${onClick ? 'interactive' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}>
      <div className="stat-label">{label}{tag}</div>
      <div className={`stat-value ${large ? 'lg' : ''} ${tone ?? ''}`}>{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Progress({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  const Icon = kind === 'warn' ? AlertTriangle : kind === 'danger' ? XCircle : kind === 'ok' ? CheckCircle2 : Info;
  return <div className={`callout ${kind}`} role={kind === 'danger' ? 'alert' : 'note'}><Icon /><div className="grow">{children}</div></div>;
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ label, value, onChange, hint, error, type = 'text', placeholder, className, prefix, suffix, ...rest }: {
  label: ReactNode; value: string | number | null | undefined; onChange: (v: string) => void; hint?: ReactNode; error?: string; type?: string;
  placeholder?: string; className?: string; prefix?: string; suffix?: string; min?: number; max?: number; step?: string; disabled?: boolean; autoFocus?: boolean; onBlur?: () => void; list?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <div className={prefix || suffix ? 'input-wrap' : undefined}>
          {prefix && <span className="prefix">{prefix}</span>}
          <input id={id} className={`input ${error ? 'invalid' : ''}`} type={type} value={value ?? ''} placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} style={suffix ? { paddingRight: 34 } : undefined} {...rest} />
          {suffix && <span className="suffix">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function MoneyInput(props: { label: ReactNode; value: string | null | undefined; onChange: (v: string) => void; hint?: ReactNode; error?: string; className?: string; placeholder?: string; disabled?: boolean }) {
  const { prefs } = useStore();
  const symbol = prefs.currency === 'INR' ? '₹' : prefs.currency === 'USD' ? '$' : prefs.currency === 'EUR' ? '€' : prefs.currency === 'GBP' ? '£' : '';
  return <TextInput {...props} type="text" prefix={symbol} placeholder={props.placeholder ?? '0.00'} onChange={(v) => props.onChange(v.replace(/[^\d.]/g, ''))} />;
}

export function Select<T extends string | number>({ label, value, onChange, options, hint, error, className }: {
  label: ReactNode; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hint?: ReactNode; error?: string; className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <select id={id} className="input" value={String(value)} onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}>
          {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="row between" style={{ padding: '6px 0' }}>
      <label htmlFor={id} className="grow" style={{ cursor: 'pointer' }}>
        <div>{label}</div>
        {hint && <div className="small faint">{hint}</div>}
      </label>
      <span className="switch"><input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></span>
    </div>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function BtnGroup<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div className="btn-group" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.value} role="tab" aria-selected={t.value === value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>{t.label}</button>)}
    </div>
  );
}

export function Modal({ title, sub, onClose, children, footer, size }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return; // only the topmost dialog reacts
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  // portal to <body> so nested dialogs are never clipped by a transformed parent
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head">
          <div><h2 className="modal-title">{title}</h2>{sub && <p className="section-sub">{sub}</p>}</div>
          <button className="btn ghost icon modal-close" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog; `typeToConfirm` requires the user to type an exact phrase. */
export function Confirm({ title, children, confirmLabel = 'Confirm', danger, typeToConfirm, onConfirm, onClose, busy }: {
  title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; typeToConfirm?: string; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const ok = !typeToConfirm || typed.trim() === typeToConfirm.trim();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ok || busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button>
    </>}>
      <div className="col">
        {children}
        {typeToConfirm && <TextInput label={<>Type <b>{typeToConfirm}</b> to confirm</>} value={typed} onChange={setTyped} />}
      </div>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? <XCircle size={17} /> : t.kind === 'success' ? <CheckCircle2 size={17} /> : <Info size={17} color="var(--info)" />}
          <div className="grow"><div className="t-title">{t.title}</div>{t.body && <div className="t-body">{t.body}</div>}</div>
          <button className="btn ghost icon sm" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v], i) => <div key={i} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function LoanDot({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color, borderRadius: '50%' }} />;
}
