import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './ui';
import planCatalog from '../../shared/plans.json';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function ProblemSection() {
  return <section className="mx-section mx-problem" aria-labelledby="mx-problem-title">
    <SectionHead eyebrow="The gap" title={<>Knowing your numbers isn't the same as <em>understanding your business.</em></>} text="Business finances are spread across records and dates. A useful view makes the connections easier to follow." id="mx-problem-title" />
    <div className="mx-problem-grid">
      <article className="mx-problem-item problem-in"><span className="mx-index">01 / IN</span><div className="mx-mini-ledger"><b>INCOMING</b><i>Client A <span>$12,400</span></i><i>Client B <span>$8,100</span></i><i>Client C <span>Due soon</span></i></div><h3>Money is moving.<br />The whole picture isn't.</h3><p>Invoices, balances and expenses tell different parts of the story until you bring the records into the same view.</p></article>
      <article className="mx-problem-item problem-late"><span className="mx-index">02 / NOTICE</span><div className="mx-calendar"><div><span>MON</span><b>12</b><i /></div><div><span>TUE</span><b>13</b><i /></div><div className="late"><span>WED</span><b>14</b><i /></div><div><span>THU</span><b>15</b><i /></div><div><span>FRI</span><b>16</b><i /></div><strong>Payment arrives after payroll</strong></div><h3>Small changes surface<br />after the pressure.</h3><p>Late receivables and recurring costs can become urgent when their timing is hard to see together.</p></article>
      <article className="mx-problem-item problem-ahead"><span className="mx-index">03 / DECIDE</span><div className="mx-decision-visual"><svg viewBox="0 0 300 100" role="img" aria-label="Illustrative cash outlook branches into three possible scenarios"><path d="M0 76H80M80 76C140 76 154 20 220 20h80M80 76C150 76 200 50 300 50M80 76c70 0 90 22 150 22h70" fill="none" stroke="#8d98a5" strokeWidth="2"/><circle cx="80" cy="76" r="5" fill="#c9a86a"/><text x="224" y="14">HIRE</text><text x="244" y="45">WAIT</text><text x="224" y="96">INVEST</text></svg></div><h3>Decisions carry<br />different outcomes.</h3><p>Looking at the assumptions behind a possible choice can help make the trade-offs clearer before acting.</p></article>
    </div>
  </section>;
}

type PillarKey = 'core' | 'monitor' | 'horizon' | 'intelligence';
const pillars: { id: PillarKey; number: string; label: string; title: string; summary: string; detail: string }[] = [
  { id: 'core', number: '01', label: 'FINANCIAL CORE', title: 'Start with what is recorded.', summary: 'A working view of business activity.', detail: 'Organize transactions, accounts, invoices, bills, receivables and payables. Each number stays connected to its underlying record.' },
  { id: 'monitor', number: '02', label: 'MONITOR', title: 'See what deserves a look.', summary: 'Changes, with their evidence nearby.', detail: 'Review due dates, unusual activity and recurring cost changes with the source record and reason each item was surfaced.' },
  { id: 'horizon', number: '03', label: 'HORIZON', title: 'Explore what could happen next.', summary: 'A forecast that shows its assumptions.', detail: 'Project cash using recorded balances, invoices, bills, planned items and scenario adjustments. Estimates remain distinct from actuals.' },
  { id: 'intelligence', number: '04', label: 'MORGAN INTELLIGENCE', title: 'Ask for context around the figures.', summary: 'Explanations grounded in your records.', detail: 'Morgan can explain supplied financial context. Calculations stay deterministic; AI interpretation does not edit your ledger.' },
];

export function PillarExplorer() {
  const [active, setActive] = useState<PillarKey>('core');
  const item = pillars.find((p) => p.id === active)!;
  return <section className="mx-section mx-system" id="morgan-system" aria-labelledby="mx-system-title">
    <SectionHead eyebrow="One connected workspace" title={<>Four parts. <em>One financial picture.</em></>} text="Move from records, to changes, to possible outcomes, with context that stays close to the numbers." id="mx-system-title" />
    <div className="mx-pillar-explorer">
      <div className="mx-pillar-tabs" role="group" aria-label="Morgan capabilities">{pillars.map((p) => <button key={p.id} type="button" aria-pressed={active === p.id} aria-controls="mx-pillar-panel" onClick={() => setActive(p.id)}><span>{p.number}</span><b>{p.label}</b><i aria-hidden="true">↗</i></button>)}</div>
      <div className={`mx-pillar-panel visual-${item.id}`} id="mx-pillar-panel" aria-live="polite">
        <PillarVisual type={item.id} />
        <div className="mx-pillar-copy"><span className="mx-kicker">{item.number} — {item.label}</span><h3>{item.title}</h3><p className="mx-pillar-summary">{item.summary}</p><p>{item.detail}</p><Link className="mx-text-link" to="/features">Explore the product <Icon name="arrowRight" size={15} /></Link></div>
      </div>
    </div>
  </section>;
}

export function PillarVisual({ type }: { type: PillarKey }) {
  if (type === 'core') return <div className="mx-ledger-visual" aria-label="Illustrative ledger with accounts and classified transactions"><div className="mx-ledger-top"><span>FINANCIAL CORE / CASH ACTIVITY</span><b>Sample business · illustrative</b></div><div className="mx-ledger-balance"><small>Recorded cash position</small><strong>$84,260.00</strong><span>Three accounts · USD</span></div><div className="mx-ledger-rows"><div className="row-head"><span>DATE / RECORD</span><span>CLASSIFICATION</span><span>AMOUNT</span></div><div><span>Oct 17 <b>Northstar Studio</b></span><span>Income</span><strong className="positive">+$4,800.00</strong></div><div><span>Oct 16 <b>Payroll · weekly</b></span><span>Expense</span><strong>−$3,250.00</strong></div><div><span>Oct 14 <b>Workspace rent</b></span><span>Recurring</span><strong>−$1,850.00</strong></div></div><div className="mx-ledger-foot"><span>12 records this period</span><span>OPEN LEDGER ↗</span></div></div>;
  if (type === 'monitor') return <div className="mx-monitor-visual" aria-label="Illustrative monitoring timeline showing the reason and evidence for a finding"><div className="mx-monitor-heading"><span>MONITOR / ITEMS TO REVIEW</span><small>3 findings · sample business</small></div><div className="mx-event"><time>OCT 18<br /><b>09:20</b></time><i className="event-dot"/><div><small>PAYMENT TIMING</small><h4>Client invoice is 8 days overdue</h4><p>Due date passed · invoice still marked sent</p><div className="mx-evidence"><span>RECORD</span><b>INV-0108 · Cedar House</b><strong>$12,340.50</strong></div></div></div><div className="mx-event"><time>OCT 16<br /><b>14:05</b></time><i className="event-dot muted-dot"/><div><small>RECURRING COST</small><h4>Cloud hosting increased</h4><p>Compared with the previous recurring charge</p><div className="mx-evidence"><span>RECORD</span><b>Cloudframe · Oct statement</b><strong>+$84.00</strong></div></div></div><div className="mx-event"><time>OCT 14<br /><b>08:42</b></time><i className="event-dot pale-dot"/><div><small>REVIEW SIGNAL</small><h4>Two expenses share a reference</h4><p>Possible duplicate · check the imported entries</p><div className="mx-evidence"><span>RECORDS</span><b>TXN-0341 · TXN-0346</b><strong>Review</strong></div></div></div></div>;
  if (type === 'horizon') return <HorizonChartMini />;
  return <div className="mx-ai-visual"><div className="mx-ai-top"><span>MORGAN INTELLIGENCE</span><span>ILLUSTRATIVE EXPLANATION</span></div><div className="mx-ai-question"><small>BUSINESS OWNER</small><p>“Could I cover a new contractor next month?”</p></div><div className="mx-ai-answer"><small>CONTEXTUAL EXPLANATION</small><p>Your baseline estimate leaves <b>$18,420</b> at month end. Adding the planned $4,500 monthly cost brings that estimate to <b>$13,920</b>, before any payment timing changes.</p><p>The result is a projection from your current records and assumptions. It is not a recommendation or guarantee.</p></div><div className="mx-ai-evidence"><span>CALCULATED FIGURES</span><b>Horizon baseline · 30 days</b><b>Planned item · Contractor</b></div></div>;
}

function HorizonChartMini() {
  return <div className="mx-chart-visual"><div className="mx-chart-head"><div><span>HORIZON / 90-DAY OUTLOOK</span><strong>Cash position · estimate</strong></div><span>Illustrative only</span></div><svg viewBox="0 0 520 250" role="img" aria-label="Illustrative forecast chart with conservative, baseline, and optimistic cash projections"><path d="M38 30V210H500M38 165H500M38 120H500M38 75H500" className="chart-grid"/><text x="0" y="34">$100k</text><text x="7" y="124">$60k</text><text x="7" y="214">$20k</text><path d="M42 124C105 118 139 142 200 132S290 120 330 136" className="chart-recorded"/><path d="M330 136C380 149 413 162 495 182" className="chart-low"/><path d="M330 136C383 127 430 108 495 102" className="chart-base"/><path d="M330 136C382 102 430 68 495 52" className="chart-high"/><line x1="330" y1="26" x2="330" y2="210" className="chart-today"/><text x="309" y="232">TODAY</text><text x="38" y="232">OCT 18</text><text x="470" y="232">JAN 16</text></svg><div className="mx-chart-legend"><span><i className="legend-solid"/>Recorded</span><span><i className="legend-dash"/>Conservative</span><span><i className="legend-base"/>Base</span><span><i className="legend-high"/>Optimistic</span></div></div>;
}

export function HorizonShowcase() {
  const [scenario, setScenario] = useState<'conservative' | 'base' | 'optimistic'>('base');
  const [delay, setDelay] = useState(0);
  const forecast = useMemo(() => {
    const base = { conservative: [84260, 73600, 58500, 46500], base: [84260, 80600, 73800, 68400], optimistic: [84260, 88600, 97300, 108600] }[scenario];
    const delayed = delay > 0;
    const values = base.map((value, i) => Math.round(value - (delayed && i > 0 && i * 30 < 30 + delay ? 12400 : 0)));
    return { values, end: values[values.length - 1], timingDelta: values[1] - base[1] };
  }, [scenario, delay]);
  const y = (v: number) => 20 + ((110000 - v) / 70000) * 160;
  const d = forecast.values.map((v, i) => `${i ? 'L' : 'M'} ${40 + i * 100} ${y(v)}`).join(' ');
  return <section className="mx-horizon" aria-labelledby="mx-horizon-title">
    <div className="mx-horizon-copy"><span className="mx-kicker">LOOK AHEAD / HORIZON</span><h2 id="mx-horizon-title">See where today's decisions <em>could take you.</em></h2><p>Understand how incoming payments, recurring expenses and changing assumptions could affect your future cash position.</p><p className="mx-note">Illustrative forecast · example data only</p><div className="mx-assumption"><label htmlFor="mx-delay">Delay one client payment</label><div className="mx-range-row"><input id="mx-delay" type="range" min="0" max="60" step="5" value={delay} onChange={(e) => setDelay(Number(e.target.value))} /><output htmlFor="mx-delay">{delay === 0 ? 'On time' : `${delay} days`}</output></div><small>Example invoice: $12,400 · due in 30 days</small></div></div>
    <div className="mx-forecast-panel"><div className="mx-forecast-top"><div><span>PROJECTED CASH POSITION</span><strong>{money(forecast.end)}</strong><small>Day 90 estimate · illustrative</small></div><div className="mx-scenario-control" role="group" aria-label="Forecast scenario">{(['conservative', 'base', 'optimistic'] as const).map((s) => <button key={s} type="button" aria-pressed={scenario === s} onClick={() => setScenario(s)}>{s === 'base' ? 'Base' : s[0].toUpperCase() + s.slice(1)}</button>)}</div></div>
      <svg className="mx-forecast-chart" viewBox="0 0 380 220" role="img" aria-label={`${scenario} 90-day cash forecast, ending at ${money(forecast.end)}${delay ? ` after a ${delay}-day payment delay` : ''}`}><path d="M40 20V180H360M40 140H360M40 100H360M40 60H360" className="forecast-grid"/><text x="0" y="25">$110k</text><text x="4" y="105">$75k</text><text x="4" y="185">$40k</text><path d="M40 84L140 84" className="forecast-actual"/><path d={d} className={`forecast-projection scenario-${scenario}`} /><line x1="140" y1="22" x2="140" y2="180" className="forecast-today"/><circle cx="140" cy="84" r="5" className="forecast-point"/><circle cx="340" cy={y(forecast.end)} r="5" className="forecast-point"/><text x="120" y="204">TODAY</text><text x="222" y="204">30 days</text><text x="326" y="204">90 days</text></svg>
      <div className="mx-forecast-foot"><span><i />Recorded</span><span><i className="dash" />Estimate</span><strong>{delay > 0 ? `A ${delay}-day delay lowers the day-30 estimate by ${money(Math.abs(forecast.timingDelta))}; it arrives later in this example.` : `${scenario[0].toUpperCase() + scenario.slice(1)} scenario · assumptions visible.`}</strong></div>
    </div>
  </section>;
}

export function MonitorShowcase() {
  return <section className="mx-section mx-monitor-showcase" aria-labelledby="mx-monitor-title"><SectionHead eyebrow="Monitor / changes with context" title={<>Notice what changed <em>before it becomes a problem.</em></>} text="A finding should tell you what moved, what record triggered it, and why it may deserve a closer look." id="mx-monitor-title" />
    <div className="mx-monitor-stage"><div className="mx-monitor-rail"><span>OCT 18</span><i/><span>OCT 16</span><i/><span>OCT 14</span></div><div className="mx-monitor-rows"><article><div><span className="mx-severity">PAYMENT TIMING</span><time>09:20 · OCT 18</time></div><h3>An invoice passed its due date.</h3><p>INV-0108 was due Oct 10 and remains marked sent. Check for a payment or an updated agreement before following up.</p><footer><span>CEDAR HOUSE</span><b>$12,340.50</b><Link to="/features#monitor">View source record ↗</Link></footer></article><article><div><span className="mx-severity sage">RECURRING COST</span><time>14:05 · OCT 16</time></div><h3>A recurring charge increased.</h3><p>The latest hosting expense is higher than the previous recorded charge for the same vendor.</p><footer><span>CLOUDFRAME · OCTOBER</span><b>+$84.00</b><Link to="/features#monitor">Compare entries ↗</Link></footer></article><article><div><span className="mx-severity quiet">CASH PATTERN</span><time>08:42 · OCT 14</time></div><h3>Two payments land after payroll.</h3><p>The timing in your current records creates a tighter week in the base estimate. Review the related dates in Horizon.</p><footer><span>HORIZON · WEEK OF OCT 27</span><b>ESTIMATE</b><Link to="/features#horizon">Review assumptions ↗</Link></footer></article></div><div className="mx-monitor-margin"><small>Sample business</small><strong>Illustrative<br />activity</strong><span>Findings require your review and are linked to the records supplied.</span></div></div>
  </section>;
}

export function IntelligenceShowcase() {
  return <section className="mx-intelligence" aria-labelledby="mx-intelligence-title"><div className="mx-intelligence-copy"><span className="mx-kicker">MORGAN INTELLIGENCE / GROUNDED CONTEXT</span><h2 id="mx-intelligence-title">Financial information, <em>explained.</em></h2><p>Ask about the records and estimates in your workspace. Morgan Intelligence can help explain the context; it does not create the underlying financial calculations.</p><Link className="mx-text-link" to="/features#intelligence">How the explanation works <Icon name="arrowRight" size={15} /></Link></div><div className="mx-conversation"><div className="mx-conversation-top"><span>ILLUSTRATIVE CONVERSATION</span><span><i /> SUPPLIED DATA</span></div><div className="mx-question"><small>YOU ASKED</small><p>“Why does the cash estimate dip in the last week of October?”</p></div><div className="mx-response"><small>MORGAN INTELLIGENCE</small><p>The base estimate includes <b>$14,200</b> in payroll that week. It also places a <b>$12,340</b> invoice payment in early November based on its saved due date.</p><p>If that payment arrives later, the lower balance lasts longer. The estimate uses your current invoice and bill dates; it cannot confirm when a client will pay.</p><div className="mx-citations"><span>CALCULATED IN HORIZON</span><a href="/app/horizon">Week of Oct 27 · projected balance ↗</a><a href="/app/invoices">INV-0108 · due Nov 3 ↗</a><a href="/app/bills">Payroll schedule · Oct 30 ↗</a></div></div><div className="mx-conversation-foot">Calculations are deterministic. AI provides explanation only.</div></div></section>;
}

export function ReportShowcase() {
  return <section className="mx-section mx-report" aria-labelledby="mx-report-title"><div className="mx-report-copy"><span className="mx-kicker">REPORTS / YOUR RECORDS, MADE USEFUL</span><h2 id="mx-report-title">Turn financial activity into <em>something you can use.</em></h2><p>Review a period, understand the movement and share a report with the people who help run the business.</p><Link className="mx-text-link" to="/features#reports">Explore reporting <Icon name="arrowRight" size={15} /></Link></div><div className="mx-report-art"><div className="mx-report-shadow"/><article className="mx-report-page"><header><b>MORGAN / FINANCIAL REVIEW</b><span>ILLUSTRATIVE · OCT 2026</span></header><small>MONTHLY BUSINESS REVIEW</small><h3>October, in view.</h3><p>Recorded activity and a short outlook for the weeks ahead.</p><div className="mx-report-summary"><div><span>INCOME</span><b>$64,820</b></div><div><span>EXPENSES</span><b>$51,400</b></div><div><span>NET MOVEMENT</span><b>+$13,420</b></div></div><div className="mx-report-chart"><span>RECORDED CASH → ESTIMATE</span><svg viewBox="0 0 360 90" aria-label="Illustrative report chart"><path d="M0 70H360M0 45H360M0 20H360"/><path d="M5 64C45 58 67 30 108 39S171 60 206 36" className="report-line"/><path d="M206 36c48-17 80 3 148-20" className="report-estimate"/></svg></div><aside><b>Worth a closer look</b><span>One major invoice is due early next month; its timing affects the cash estimate.</span></aside><footer>Figures calculated from supplied business records. Forecast is an estimate.</footer></article><div className="mx-report-label">SAMPLE REPORT<br /><span>NOT CUSTOMER DATA</span></div></div></section>;
}

export function WorkflowSection() {
  const steps = [
    ['01', 'Add your records', 'Enter activity or import a statement for review.'],
    ['02', 'Build the picture', 'Bring accounts, transactions and obligations into one view.'],
    ['03', 'Explore what changes', 'Review findings, assumptions and possible scenarios.'],
    ['04', 'Decide with context', 'Use the records and outlook in your own business decisions.'],
  ];
  return <section className="mx-section mx-workflow" aria-labelledby="mx-workflow-title"><SectionHead eyebrow="A practical way to work" title={<>From records <em>to a clearer decision.</em></>} text="Morgan is designed to keep each step inspectable, from the source record to a possible future outcome." id="mx-workflow-title" /><div className="mx-workflow-line">{steps.map(([n, title, body], i) => <article key={n} className={`workflow-step step-${i + 1}`}><span>{n}</span><i/><h3>{title}</h3><p>{body}</p></article>)}</div></section>;
}

export function PricingShowcase() {
  const [annual, setAnnual] = useState(false);
  const summaries = { starter: 'Starter limits are active.', pro: 'Published Pro allowances; paid checkout and activation are unavailable.', max: 'Published Max allowances; paid checkout and activation are unavailable.' };
  const plans = Object.values(planCatalog).map((plan) => ({
    name: plan.name, monthly: plan.monthlyCents ? `$${(plan.monthlyCents / 100).toFixed(2)}` : 'Free',
    annual: plan.annualCents ? `$${(plan.annualCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'Free',
    note: plan.monthlyCents ? `Save $${((plan.monthlyCents * 12 - plan.annualCents) / 100).toFixed(2)} per year` : 'No trial', accent: plan.id,
    features: [`${plan.limits.workspaces} workspace · ${plan.limits.seats} seat${plan.limits.seats === 1 ? '' : 's'}`, `${plan.limits.financialRecords.toLocaleString()} new financial records/month`, `${plan.limits.forecastDays}-day Horizon · ${plan.limits.scenariosPerWorkspace} saved scenario${plan.limits.scenariosPerWorkspace === 1 ? '' : 's'}`, `${plan.limits.intelligenceRequests} Intelligence responses · ${plan.limits.pdfReports} PDFs/month`, `Monitor: ${plan.monitor === 'core' ? 'core functionality' : 'full functionality'}`, summaries[plan.id as keyof typeof summaries]],
  }));
  return <section className="mx-section mx-pricing" aria-labelledby="mx-pricing-title"><SectionHead eyebrow="Plans / clear before you choose" title={<>Choose the level of <em>financial clarity you need.</em></>} text="Starter limits are active. Pro and Max prices and allowances are published, but paid checkout and activation are not configured." id="mx-pricing-title" />
    <div className="mx-pricing-bar"><span>PRICING IN USD</span><div className="mx-billing-toggle" role="group" aria-label="Billing frequency"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Annual</button></div></div>
    <div className="mx-plan-layout">{plans.map((plan, i) => <article className={`mx-plan mx-plan-${plan.accent}`} key={plan.name}><div className="mx-plan-top"><span>0{i + 1} / PLAN</span><h3>{plan.name}</h3></div><div className="mx-plan-price"><b key={annual ? 'annual' : 'monthly'}>{annual ? plan.annual : plan.monthly}</b><span>{plan.name === 'Starter' ? 'always free' : annual ? 'per year' : 'per month'}</span></div><small key={annual ? 'annual-note' : 'monthly-note'} className="mx-plan-note">{annual && plan.name !== 'Starter' ? plan.note : plan.name === 'Starter' ? 'No trial or payment details' : 'No trial is active while billing is unavailable'}</small><ul>{plan.features.map((f) => <li key={f}>{f}</li>)}</ul>{plan.name === 'Starter' ? <Link className="mx-button mx-button-dark" to="/signup">Start free <Icon name="upRight" size={15}/></Link> : <Link className="mx-text-link" to="/pricing#paid-plans">Plan availability <Icon name="arrowRight" size={15}/></Link>}</article>)}</div>
    <Link className="mx-pricing-more" to="/pricing">Full pricing and billing details <Icon name="arrowRight" size={15}/></Link>
  </section>;
}

export function MarketingFaq() {
  const [open, setOpen] = useState<number | null>(null);
  const items = [
    ['What does Morgan do?', 'Morgan brings business records, cash activity, invoices, bills, monitoring and cash estimates into one workspace.'],
    ['How does financial information get into Morgan?', 'Enter records or import transactions from a CSV. Morgan does not connect to banks or payment services.'],
    ['How does Horizon forecasting work?', 'It estimates future cash from your recorded balance, activity, open invoices and bills, plus visible timing assumptions.'],
    ['What does Morgan Intelligence do?', 'When configured, it explains supplied records and Horizon results. Morgan calculates the figures; AI does not edit records.'],
    ['How is my information handled?', 'Business records are scoped to your account. When Gemini is configured, only a bounded context for your question is sent for an explanation.'],
    ['What about plans, billing and cancellation?', 'Starter is free with active usage limits. Pro and Max prices and allowances are published, but paid checkout and subscriptions are not active, so upgrades and cancellations are unavailable.'],
  ];
  return <section className="mx-section mx-faq" aria-labelledby="mx-faq-title"><div className="mx-faq-intro"><span className="mx-kicker">QUESTIONS / ANSWERS</span><h2 id="mx-faq-title">A few clear<br /><em>answers.</em></h2><Link className="mx-text-link" to="/faq">Visit the full FAQ <Icon name="arrowRight" size={15}/></Link></div><div className="mx-faq-list">{items.map(([q, a], i) => { const expanded = open === i; const answerId = `mx-faq-answer-${i}`; return <article key={q} className={`mx-faq-item${expanded ? ' is-open' : ''}`}><button className="mx-faq-toggle" type="button" aria-expanded={expanded} aria-controls={answerId} onClick={() => setOpen(expanded ? null : i)}><span>{String(i + 1).padStart(2, '0')}</span><b>{q}</b><i aria-hidden="true">+</i></button><div className="mx-faq-answer" id={answerId} aria-hidden={!expanded}><div><p>{a}</p></div></div></article>; })}</div></section>;
}

export function ClosingSection() {
  return <section className="mx-closing"><div className="mx-closing-grid" aria-hidden="true"/><div className="mx-closing-copy"><span className="mx-kicker">YOUR BUSINESS, IN VIEW</span><h2>See your business <em>clearly.</em></h2><p>Bring your financial records together and understand what comes next.</p><Link className="mx-button mx-button-paper" to="/signup">Start free <Icon name="upRight" size={15}/></Link><small>No payment details. No trial. Your records stay yours.</small></div><svg className="mx-closing-art" viewBox="0 0 500 300" aria-hidden="true"><path d="M10 242h480M10 195h480M10 148h480M10 101h480M10 54h480"/><path d="M20 214c55-10 73-45 126-38s63 27 111 5 71-15 105-47" className="closing-recorded"/><path d="M362 134c40-26 72-37 118-62" className="closing-estimate"/><circle cx="362" cy="134" r="7"/><text x="349" y="275">TODAY</text><text x="430" y="275">90 DAYS</text></svg></section>;
}

function SectionHead({ eyebrow, title, text, id }: { eyebrow: string; title: React.ReactNode; text: string; id: string }) {
  return <header className="mx-section-head"><span className="mx-kicker">{eyebrow}</span><h2 id={id}>{title}</h2><p>{text}</p></header>;
}
