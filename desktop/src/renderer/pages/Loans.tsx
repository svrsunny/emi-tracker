import { useMemo, useState } from 'react';
import { Landmark, Plus, Upload } from 'lucide-react';
import { maskRef } from '../../shared/format';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { LoanWizard } from '../components/forms';
import { ImportDialog } from '../components/ImportDialog';
import { BtnGroup, Empty, Estimate, LOAN_TYPE_LABEL, Money, Progress, Select } from '../components/ui';
import type { Preferences } from '../../shared/types';

export function Loans() {
  const { data, comps, fmt, prefs, savePrefs } = useStore();
  const { go } = useRouter();
  const [wizard, setWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Preferences['loanFilter']>(prefs.loanFilter);
  const [sort, setSort] = useState<Preferences['loanSort']>(prefs.loanSort);
  const [lender, setLender] = useState('');

  const lenders = [...new Set(data.loans.map((l) => l.lender).filter(Boolean))].sort();
  const loans = useMemo(() => {
    const xs = data.loans.filter((l) => (filter === 'all' || l.status === filter || (filter === 'closed' && l.status === 'foreclosed')) && (!lender || l.lender === lender));
    const s = (id: string) => comps.get(id)!.summary;
    return xs.sort((a, b) => {
      switch (sort) {
        case 'outstanding': return +s(b.id).outstandingPrincipal - +s(a.id).outstandingPrincipal;
        case 'closure': return (s(a.id).closureDate ?? '9999').localeCompare(s(b.id).closureDate ?? '9999');
        case 'rate': return +b.annualRate - +a.annualRate;
        case 'next_due': return (s(a.id).nextDue?.date ?? '9999').localeCompare(s(b.id).nextDue?.date ?? '9999');
        default: return a.name.localeCompare(b.name);
      }
    });
  }, [data.loans, comps, filter, sort, lender]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">All loans</h1><p className="page-sub">{data.loans.filter((l) => l.status === 'active').length} active · {data.loans.length} total</p></div>
        <div className="row wrap">
          <BtnGroup label="Status" value={filter} onChange={(v) => { setFilter(v); void savePrefs({ ...prefs, loanFilter: v }); }} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} />
          <div style={{ width: 170 }}><Select label={<span className="sr-only">Sort</span>} value={sort} onChange={(v) => { setSort(v); void savePrefs({ ...prefs, loanSort: v }); }} options={[{ value: 'next_due', label: 'Sort: next due' }, { value: 'outstanding', label: 'Sort: outstanding' }, { value: 'closure', label: 'Sort: closure date' }, { value: 'rate', label: 'Sort: interest rate' }, { value: 'name', label: 'Sort: name' }]} /></div>
          {lenders.length > 1 && <div style={{ width: 170 }}><Select label={<span className="sr-only">Lender</span>} value={lender} onChange={setLender} options={[{ value: '', label: 'All lenders' }, ...lenders.map((x) => ({ value: x, label: x }))]} /></div>}
          <button className="btn" onClick={() => setImporting(true)}><Upload />Import</button>
          <button className="btn primary" onClick={() => setWizard(true)}><Plus />Add loan</button>
        </div>
      </div>
      {!loans.length ? (
        <div className="card"><Empty icon={<Landmark />} title={data.loans.length ? 'No loans match these filters' : 'No loans yet'} action={<button className="btn primary" onClick={() => setWizard(true)}><Plus />Add loan</button>}>
          {data.loans.length ? 'Try a different status or lender.' : 'Create a loan with the guided wizard or import from a spreadsheet or backup.'}
        </Empty></div>
      ) : (
        <div className="grid g3">
          {loans.map((l) => {
            const s = comps.get(l.id)!.summary;
            return (
              <div key={l.id} className="card interactive" role="link" tabIndex={0} onClick={() => go(`/loans/${l.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') go(`/loans/${l.id}`); }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <div className="row" style={{ minWidth: 0 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: `${l.color}22`, color: l.color, display: 'grid', placeItems: 'center', flex: 'none' }}><Landmark size={16} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                      <div className="tiny faint">{l.lender || 'No lender'} · {LOAN_TYPE_LABEL[l.loanType]}{l.accountRef ? ` · ${maskRef(l.accountRef, l.maskAccountRef)}` : ''}</div>
                    </div>
                  </div>
                  <span className="tag">{l.status}</span>
                </div>
                <div className="row between" style={{ alignItems: 'flex-end' }}>
                  <div><div className="stat-label">Outstanding {s.isEstimate && <Estimate />}</div><div className="stat-value"><Money v={s.outstandingPrincipal} /></div></div>
                  <div className="right small"><div className="muted">{l.loanType === 'chit_fund' ? <>Installment <Money v={s.currentEmi} /></> : <>{comps.get(l.id)!.rows.find((r) => r.no === s.currentInstallment)?.rate ?? l.annualRate}% · EMI <Money v={s.currentEmi} /></>}</div><div className="faint">closes {s.closureDate ? fmt.month(s.closureDate.slice(0, 7)) : '—'}</div></div>
                </div>
                <div style={{ margin: '12px 0 6px' }}><Progress pct={s.progressPct} color={l.color} /></div>
                <div className="row between tiny faint">
                  <span>{s.installmentsPaid}/{s.totalInstallments} paid · {s.installmentsRemaining} left</span>
                  {s.overdueCount > 0 ? <span className="neg">{s.overdueCount} overdue</span> : s.nextDue ? <span>next {fmt.date(s.nextDue.date)}</span> : <span className="pos">No dues</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {wizard && <LoanWizard onClose={() => setWizard(false)} onSaved={(l) => go(`/loans/${l.id}`)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
