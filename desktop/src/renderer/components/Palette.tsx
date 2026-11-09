import { useMemo, useState, type ComponentType } from 'react';
import { ArrowRight, CreditCard, Landmark, Receipt } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { PAYMENT_TYPE_LABEL } from './ui';

interface Item { key: string; icon: ComponentType<{ size?: number }>; title: string; sub: string; to: string }

/** Global search across pages, loans, lenders, notes, payments and references. */
export function Palette({ onClose, pages }: { onClose: () => void; pages: { path: string; label: string; icon: ComponentType<{ size?: number }> }[] }) {
  const { data, fmt } = useStore();
  const { go } = useRouter();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = useMemo<Item[]>(() => {
    const loanName = (id: string) => data.loans.find((l) => l.id === id)?.name ?? 'Unknown loan';
    const s = q.trim().toLowerCase();
    const out: Item[] = [];
    for (const p of pages) if (!s || p.label.toLowerCase().includes(s)) out.push({ key: `p${p.path}`, icon: p.icon, title: p.label, sub: 'Page', to: p.path });
    if (!s) return out;
    for (const l of data.loans) {
      const hay = [l.name, l.lender, l.category, l.notes, l.accountRef, l.loanType].join(' ').toLowerCase();
      if (hay.includes(s)) out.push({ key: `l${l.id}`, icon: Landmark, title: l.name, sub: `${l.lender || 'No lender'} · ${l.category} · ${l.status}`, to: `/loans/${l.id}` });
    }
    for (const p of data.payments) {
      const hay = [p.reference, p.notes, p.amount, p.txnDate, PAYMENT_TYPE_LABEL[p.type], loanName(p.loanId)].join(' ').toLowerCase();
      if (hay.includes(s)) out.push({ key: `y${p.id}`, icon: p.type === 'prepayment' ? CreditCard : Receipt, title: `${PAYMENT_TYPE_LABEL[p.type]} · ${fmt.money(p.amount)}`,
        sub: `${loanName(p.loanId)} · ${fmt.date(p.txnDate)}${p.reference ? ` · Ref ${p.reference}` : ''}${p.status === 'reversed' ? ' · reversed' : ''}`, to: `/payments?highlight=${p.id}` });
      if (out.length > 60) break;
    }
    return out;
  }, [q, data, pages, fmt]);

  const open = (it: Item | undefined) => { if (!it) return; go(it.to); onClose(); };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-label="Search">
        <input autoFocus value={q} placeholder="Search loans, lenders, notes, payments, references…" aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') open(items[sel]);
          }} />
        <div className="palette-list" role="listbox">
          {items.length === 0 && <div className="empty" style={{ padding: 24 }}>No matches for “{q}”.</div>}
          {items.map((it, i) => (
            <div key={it.key} role="option" aria-selected={i === sel} className={`palette-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => open(it)}>
              <it.icon size={16} />
              <div className="grow"><div>{it.title}</div><div className="tiny faint">{it.sub}</div></div>
              <ArrowRight size={14} className="faint" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
