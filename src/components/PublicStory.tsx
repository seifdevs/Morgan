import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const stages = [
  { id: 'records', step: '01', title: 'Four ledgers. One picture.', body: 'Transactions, invoices, receivables and bills come together in one financial view. Start with the records, and keep every summary connected to its source.', label: 'Financial Core', metric: 'Records in view', value: 'Income · costs · obligations', color: '#c9a86a' },
  { id: 'monitor', step: '02', title: 'Know what needs a look.', body: 'Monitor surfaces patterns in recorded activity, such as recurring charges and unusual spending, with the transactions behind each observation.', label: 'Monitor', metric: 'Pattern to review', value: 'Recurring cost changed', color: '#d6a84f' },
  { id: 'horizon', step: '03', title: 'See where cash may go.', body: 'Horizon projects a 90-day cash path from open invoices, unpaid bills and recent activity. Recorded balances and estimated outcomes stay visually distinct.', label: 'Horizon · 90 days', metric: 'Base estimate', value: '$72,400', color: '#8d98a5' },
  { id: 'scenarios', step: '04', title: 'Test a decision first.', body: 'Model a planned hire, delayed payment or new client as an assumption. Compare its effect with the baseline before changing your records.', label: 'What-if scenario', metric: 'Planned hire · monthly', value: 'Compare against baseline', color: '#c9a86a' },
  { id: 'intelligence', step: '05', title: 'Understand the numbers.', body: 'Morgan’s financial engine calculates balances and forecasts. Gemini can explain that supplied context in plain language, with figures grounded in your records.', label: 'Morgan Intelligence', metric: 'A clearer next question', value: 'What changes if payment is late?', color: '#8d98a5' },
];

function StageVisual({ stage }: { stage: number }) {
  const item = stages[stage];
  const points = stage === 2 ? '30,110 82,94 134,105 186,70 238,86 290,45 342,63 394,33' : stage === 3 ? '30,110 82,94 134,105 186,70 238,86 290,101 342,105 394,115' : '30,110 82,94 134,105 186,70 238,86 290,45 342,63 394,33';
  return <div className={`story-screen story-screen-${item.id}`} aria-live="polite">
    <div className="story-screen-top"><span className="story-mark"><i /></span><span>MORGAN</span><span className="story-screen-label">{item.label}</span></div>
    <div className="story-screen-content">
      {stage === 0 && <div className="story-ledgers" aria-hidden="true"><span>Transactions</span><span>Invoices</span><span>Receivables</span><span>Bills</span></div>}
      {stage === 1 && <div className="story-alert"><span className="story-alert-dot" /><div><small>RECURRING SPEND · REVIEW</small><b>One recurring charge changed</b><span>Open the matching transactions</span></div><strong>View evidence ↗</strong></div>}
      {(stage === 2 || stage === 3) && <><div className="story-graph"><div className="story-y-labels"><span>$100k</span><span>$75k</span><span>$50k</span><span>$25k</span></div><svg viewBox="0 0 420 140" role="img" aria-label={stage === 2 ? 'Illustrative projected cash line over 90 days' : 'Illustrative projected cash line under a scenario'}><path d="M30 126H410M30 86H410M30 46H410" className="story-grid"/><path d={`M${points}`} className="story-line"/><path d="M238 86 L290 45 342 63 394 33" className="story-estimate"/><circle cx="30" cy="110" r="4" className="story-point"/></svg><div className="story-x-labels"><span>Today</span><span>30 days</span><span>60 days</span><span>90 days</span></div></div><div className="story-scenario-controls"><span>Conservative</span><span className="selected">Base</span><span>Optimistic</span></div></>}
      {stage === 4 && <div className="story-answer"><span>WHAT THE FORECAST SUGGESTS</span><p>“A later payment would narrow the cash buffer in the coming weeks. Review the invoice timing and planned costs together.”</p><small>Illustrative explanation · figures follow the underlying forecast</small></div>}
      <div className="story-screen-foot"><span>{item.metric}</span><b>{item.value}</b></div>
    </div>
    <div className="story-screen-progress"><i style={{ width: `${(stage + 1) * 20}%` }} /></div>
  </div>;
}

export function PublicStory() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-story-stage]')];
    if (!nodes.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(Number((visible.target as HTMLElement).dataset.storyStage));
    }, { rootMargin: '-35% 0px -45% 0px', threshold: [0, .25, .5, .75, 1] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
  return <section className="public-story" aria-labelledby="story-title">
    <div className="story-intro"><span className="eyebrow gold">One connected view</span><h2 id="story-title">From financial activity<br/><span className="serif gold">to your next decision.</span></h2><p>Morgan brings the present into focus, then helps you consider what could come next.</p></div>
    <div className="story-layout"><div className="story-stages">{stages.map((s, i) => <article className={`story-stage ${active === i ? 'active' : ''}`} key={s.id} data-story-stage={i}><span className="story-step">{s.step} / 05</span><div><span className="eyebrow">{s.label}</span><h3>{s.title}</h3><p>{s.body}</p>{i === 4 && <Link className="link" to="/features">Explore the product →</Link>}</div></article>)}</div><div className="story-visual"><StageVisual stage={active}/><p className="story-disclaimer">Illustrative product visualization. Sample figures are not customer results.</p></div></div>
  </section>;
}
