import { useState } from 'react';
import { ListOrdered } from 'lucide-react';
import { useStore } from '../lib/store';
import { ScheduleTable } from '../components/ScheduleTable';
import { Card, Empty, Estimate, Kv, Money, Projected, Select } from '../components/ui';

export function Schedules() {
  const { data, comps, fmt } = useStore();
  const loans = data.loans.filter((l) => l.status !== 'archived');
  const [id, setId] = useState(loans[0]?.id ?? '');
  const loan = data.loans.find((l) => l.id === id);
  const comp = loan ? comps.get(loan.id) : undefined;
  if (!loan || !comp) return <div className="page"><div className="card"><Empty icon={<ListOrdered />} title="No loans yet">Add a loan to see its installment-by-installment schedule.</Empty></div></div>;
  const s = comp.summary;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Amortization schedules</h1><p className="page-sub">Installment-by-installment: actual payments to date, contractual projection afterwards</p></div>
        <div style={{ width: 260 }}><Select label={<span className="sr-only">Loan</span>} value={id} onChange={setId} options={loans.map((l) => ({ value: l.id, label: l.name }))} /></div>
      </div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Card title="Schedule">
          <Kv items={[['Installments', s.totalInstallments], ['Paid', s.installmentsPaid], ['Remaining', s.installmentsRemaining], ['Current EMI', <Money key="e" v={s.currentEmi} />]]} />
        </Card>
        <Card title="Interest">
          <Kv items={[['Paid so far', <Money key="p" v={s.interestPaid} />], ['Remaining', <span key="r"><Money v={s.remainingInterest} /> <Projected /></span>], ['Lifetime', <Money key="l" v={s.lifetimeInterest} />]]} />
        </Card>
        <Card title="Principal">
          <Kv items={[['Original', <Money key="o" v={s.principal} />], ['Capitalised interest', <Money key="c" v={s.capitalizedInterest} />], ['Repaid', <Money key="r" v={s.principalRepaid} />], ['Outstanding', <Money key="out" v={s.outstandingPrincipal} />]]} />
        </Card>
        <Card title="Dates">
          <Kv items={[['First EMI', fmt.date(loan.firstEmiDate)], ['Projected last', fmt.date(s.closureDate)], ['Contract last', fmt.date(s.baselineClosureDate)], ['Rounding', loan.emiRounding.replace('_', ' ')]]} />
          {s.isEstimate && <div style={{ marginTop: 6 }}><Estimate label="Contains estimates" /></div>}
        </Card>
      </div>
      <ScheduleTable loan={loan} comp={comp} maxHeight={640} />
    </div>
  );
}
