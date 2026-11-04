import { useMemo, useState } from 'react';

const initial = { expenses: 12000, savingsRate: 3, hours: 6, hourlyValue: 75, receivables: 25000, collectionDays: 5 };
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
type InputKey = keyof typeof initial;

export function ImpactCalculator() {
  const [values, setValues] = useState(initial);
  const change = (key: InputKey, value: string) => setValues((current) => ({ ...current, [key]: Math.min(key === 'savingsRate' ? 100 : Number.MAX_SAFE_INTEGER, Math.max(0, Number(value) || 0)) }));
  const result = useMemo(() => {
    const savings = values.expenses * values.savingsRate / 100 * 12;
    const time = values.hours * values.hourlyValue * 12;
    const workingCapital = values.receivables * Math.min(values.collectionDays / 30, 1);
    return { savings, time, workingCapital, annualValue: savings + time };
  }, [values]);
  const fields: { key: InputKey; label: string; prefix?: string; suffix?: string; hint: string }[] = [
    { key: 'expenses', label: 'Monthly recurring expenses', prefix: '$', hint: 'Recurring costs you would review in Morgan.' },
    { key: 'savingsRate', label: 'Potential costs to reduce', suffix: '%', hint: 'Your estimate of costs you may be able to remove.' },
    { key: 'hours', label: 'Hours on financial admin / month', hint: 'Time spent gathering and reviewing financial information.' },
    { key: 'hourlyValue', label: 'Value of your working hour', prefix: '$', hint: 'An estimate of the value of time returned to the business.' },
    { key: 'receivables', label: 'Average outstanding receivables', prefix: '$', hint: 'Invoices currently awaiting payment.' },
    { key: 'collectionDays', label: 'Days faster you might collect', suffix: 'days', hint: 'A timing assumption only; it does not create new revenue.' },
  ];
  return <section className="impact-section" aria-labelledby="impact-title"><div className="impact-intro"><span className="eyebrow gold">The business case</span><h2 id="impact-title">Make the value <span className="serif gold">visible.</span></h2><p>Estimate what earlier visibility could mean for your business. Adjust each assumption to fit your own situation.</p></div>
    <div className="impact-calculator"><div className="impact-inputs"><h3>Your assumptions</h3><div className="impact-fields">{fields.map(({ key, label, prefix, suffix, hint }) => <label className="impact-field" key={key}><span>{label}</span><span className="impact-input-wrap">{prefix && <i>{prefix}</i>}<input type="number" min="0" max={key === 'savingsRate' ? 100 : undefined} step={key === 'savingsRate' || key === 'collectionDays' || key === 'hours' ? 1 : 100} value={values[key]} onChange={(e) => change(key, e.target.value)} aria-label={label}/>{suffix && <i>{suffix}</i>}</span><small>{hint}</small></label>)}</div></div>
    <div className="impact-results"><span className="eyebrow">Illustrative annual value</span><strong className="impact-total">{money(result.annualValue)}</strong><p>Combined annual estimate: expense savings + time value</p><dl><div><dt>Potential expense savings</dt><dd>{money(result.savings)} <small>/ year</small></dd></div><div><dt>Estimated time value recovered</dt><dd>{money(result.time)} <small>/ year</small></dd></div><div><dt>Working capital timing indicator</dt><dd>{money(result.workingCapital)} <small>/ timing only</small></dd></div></dl><div className="impact-formulas"><b>How the estimate is calculated</b><span>Expense savings = monthly expenses × reduction assumption × 12</span><span>Time value = monthly admin hours × hourly value × 12</span><span>Timing indicator = receivables × faster collection days ÷ 30</span></div></div></div>
    <p className="impact-note">Illustrative estimates only. They are not guaranteed savings, Morgan customer results, or financial advice. The annual estimate combines only potential expense savings and time value. The working capital timing indicator is shown separately, assumes receivables are distributed evenly across a 30-day period, and is not added to annual value or treated as revenue or savings.</p>
  </section>;
}
