import { Link, Navigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import { faqs, guides } from './content';
import { HorizonShowcase, IntelligenceShowcase, PillarVisual, ReportShowcase } from '../../components/MarketingExperience';
import planCatalog from '../../../shared/plans.json';

function PageIntro({ eyebrow, title, lead }: { eyebrow: string; title: React.ReactNode; lead: React.ReactNode }) {
  return (
    <header className="page-intro">
      <div className="pi-title mnote-host"><h1>{title}</h1><span className="folio mnote">{eyebrow}</span></div>
      <p className="lead">{lead}</p>
    </header>
  );
}

export function Features() {
  useDocumentTitle('Morgan product overview', 'See how Financial Core, Monitor, Horizon and Morgan Intelligence work together.', { canonicalPath: '/features' });
  return (
    <div className="page mx-product-page">
      <PageIntro eyebrow="The Morgan product" title={<>Records, changes and outlooks — <span className="serif gold">connected.</span></>} lead="Morgan organizes information you provide, calculates a position from those records, surfaces changes to review, and helps explain the context." />
      <div className="mx-product-index"><a href="#financial-core">01 Financial Core</a><a href="#monitor">02 Monitor</a><a href="#horizon">03 Horizon</a><a href="#intelligence">04 Morgan Intelligence</a><a href="#reports">05 Reports</a></div>
      <section id="financial-core" className="mx-product-deep core-deep"><div className="mx-product-text"><span className="mx-kicker">01 / FINANCIAL CORE</span><h2>Start with a record you can trace.</h2><p>Add transactions, accounts, invoices and bills, or review an imported bank statement before confirming it. Morgan recalculates totals from the saved records and keeps business balances scoped to your workspace.</p><ul><li>Classify income, expenses and transfers</li><li>Track receivables, payables and recorded payments</li><li>See the record behind a summary or total</li></ul><p className="mx-note">Morgan does not connect to bank accounts or verify statement payments.</p></div><PillarVisual type="core" /></section>
      <section id="monitor" className="mx-product-deep monitor-deep"><div className="mx-product-text"><span className="mx-kicker">02 / MONITOR</span><h2>Review the signal and its source.</h2><p>Monitor groups overdue items, possible duplicates, recurring cost changes and other review signals with references to the records that caused them. A signal is a prompt to inspect the evidence, not a conclusion about what happened.</p></div><PillarVisual type="monitor" /></section>
      <div id="horizon" className="mx-product-embedded"><HorizonShowcase /></div>
      <div id="intelligence" className="mx-product-embedded"><IntelligenceShowcase /></div>
      <div id="reports" className="mx-product-embedded"><ReportShowcase /></div>
      <section className="mx-product-use"><div><span className="mx-kicker">WORKFLOWS / PRACTICAL USE</span><h2>Use Morgan where timing matters.</h2></div><div className="mx-use-lines"><article><b>Client payment is late</b><p>Review the invoice and its saved date, then see how a delay changes the cash estimate.</p></article><article><b>Costs are rising</b><p>Compare recurring transactions and open the entries behind a potential change.</p></article><article><b>You are considering a hire</b><p>Add a planned expense to a scenario and compare possible future cash positions.</p></article></div></section>
      <section className="cta-band"><h2>See your records <span className="serif gold">in one picture.</span></h2><Link className="btn primary lg" to="/signup">Start with Starter <Icon name="upRight" size={15} /></Link><Link className="mx-text-link" to="/pricing">Review pricing <Icon name="arrowRight" size={15}/></Link></section>
    </div>
  );
}

export function Pricing() {
  const [annual, setAnnual] = useState(false);
  useDocumentTitle('Pricing', 'Compare Morgan Starter, Pro and Max monthly and annual prices, with current billing availability stated clearly.');
  const plans = Object.values(planCatalog).map((plan) => ({ ...plan, monthly: plan.monthlyCents ? `$${(plan.monthlyCents / 100).toFixed(2)}` : 'Free', annual: plan.annualCents ? `$${(plan.annualCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'Free', savings: plan.monthlyCents ? `$${((plan.monthlyCents * 12 - plan.annualCents) / 100).toFixed(2)}` : undefined, savingPct: plan.monthlyCents ? ((plan.monthlyCents * 12 - plan.annualCents) / (plan.monthlyCents * 12) * 100).toFixed(1) : undefined, status: plan.id === 'starter' ? 'Available' : 'Manual payment · admin verification', summary: plan.id === 'starter' ? 'Organize the financial information already in your records.' : plan.id === 'pro' ? 'A regular view of recorded finances, changes and outlooks.' : 'A broader planning and monitoring allowance.' }));
  return (
    <div className="page mx-pricing-page">
      <PageIntro eyebrow="Plans & pricing" title={<>Choose the level of <span className="serif gold">financial clarity you need.</span></>} lead="Starter is free. Pro and Max are available through a one-time PayPal.Me payment request; an administrator verifies payment before access changes. There is no trial or automatic renewal." />
      <section id="paid-plans" className="mx-full-pricing">
        <div className="mx-pricing-bar"><div><span className="mx-kicker">CLEAR PLANS · USD</span><small>Choose a billing period</small></div><div className="mx-billing-toggle" role="group" aria-label="Billing frequency"><button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button><button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Annual <span>Save up to 37%</span></button></div></div>
        <div className="mx-plan-layout">{plans.map((plan, i) => <article className={`mx-plan mx-plan-${plan.id}`} key={plan.id}>
          <div className="mx-plan-top"><div><span>0{i + 1} / PLAN</span><h3>{plan.name}</h3></div>{plan.id === 'pro' ? <span className="mx-plan-badge">MOST POPULAR</span> : <small className="mx-plan-status">{plan.id === 'starter' ? 'Available now' : 'Manual verification'}</small>}</div>
          <p className="mx-plan-summary">{plan.summary}</p>
          <div className="mx-plan-price"><b key={annual ? 'annual' : 'monthly'}>{annual ? plan.annual : plan.monthly}</b><span>{plan.id === 'starter' ? 'always free' : annual ? 'per year · one-time payment' : 'per month · one-time payment'}</span></div>
          <small key={annual ? 'annual-note' : 'monthly-note'} className="mx-plan-note">{plan.id === 'starter' ? 'No trial or payment required' : annual ? `Save ${plan.savings} (${plan.savingPct}%) vs. 12 monthly payments` : 'No trial · no automatic renewal'}</small>
          <div className="mx-entitlement-note"><b>Included in your plan</b><ul><li>{plan.limits.workspaces} business workspace{plan.limits.workspaces === 1 ? '' : 's'} · {plan.limits.seats} seat{plan.limits.seats === 1 ? '' : 's'}</li><li>{plan.limits.financialRecords.toLocaleString()} new financial records per month</li><li>{plan.limits.forecastDays}-day Horizon · {plan.limits.scenariosPerWorkspace} saved scenarios</li><li>{plan.limits.intelligenceRequests} Morgan Intelligence responses per month</li><li>{plan.limits.pdfReports} generated PDF reports per month</li><li>Monitor: {plan.monitor === 'core' ? 'core functionality' : 'full functionality'}</li></ul><small>{plan.id === 'starter' ? 'Starter limits are active for every account.' : 'One workspace and one account member are currently supported. Paid access starts after an administrator verifies your PayPal payment.'}</small></div>
          <Link className={`mx-plan-cta ${plan.id === 'starter' ? 'mx-plan-cta-quiet' : ''}`} to="/signup">{plan.id === 'starter' ? 'Start with Starter' : `Choose ${plan.name}`} <Icon name="upRight" size={16}/></Link>
          {plan.id !== 'starter' && <small className="mx-plan-cta-note">Create an account, then request a one-time PayPal.Me payment.</small>}
        </article>)}</div>
      </section>
      <section className="mx-trial-note"><span className="mx-kicker">TRIALS / BILLING STATUS</span><p>Starter has no trial. Pro and Max use one-time PayPal.Me payments with manual administrator verification. The payment does not recur; access ends on the displayed plan period end unless another payment is verified.</p></section>
      <section className="mx-pricing-faq"><span className="mx-kicker">BILLING QUESTIONS</span><details><summary>How do I purchase Pro or Max?</summary><p>Sign in, open Plan & usage, create a payment request, and use its PayPal.Me link. Submit the PayPal transaction ID after payment. Morgan activates paid access only after a Morgan administrator verifies the transaction in PayPal account activity.</p></details><details><summary>How much do annual plans save?</summary><p>Pro costs $499 for one year instead of $599.88 across 12 monthly payments, a $100.88 (16.8%) difference. Max costs $1,499 instead of $2,399.88, a $900.88 (37.5%) difference.</p></details><details><summary>Does payment renew automatically?</summary><p>No. PayPal.Me is a one-time payment link. There is no automatic renewal, card billing, refund automation or trial.</p></details></section>
      <section className="cta-band"><h2>Start with <span className="serif gold">Starter, free.</span></h2><Link className="btn primary lg" to="/signup">Create your account <Icon name="upRight" size={15}/></Link></section>
    </div>
  );
}

export function About() {
  useDocumentTitle('About Morgan', 'Learn why founder Seif is building Morgan as a practical financial management and insight layer for small and growing businesses.');
  return (
    <div className="page mx-about-page">
      <PageIntro eyebrow="About Morgan / The idea" title={<>Make business finances <span className="serif gold">make more sense.</span></>} lead="Morgan is being built to help business owners see their financial position more clearly and understand the information behind their next decisions." />
      <section className="mx-about-opening"><span className="mx-kicker">THE PROBLEM / FRAGMENTED INFORMATION</span><h2>Business finances live across different records, dates and conversations.</h2><p>An invoice shows what is owed. A transaction shows what moved. A bill shows what is coming due. Looking at any one record on its own leaves the wider picture incomplete.</p></section>
      <section className="mx-about-philosophy"><div><span className="mx-kicker">PRODUCT PHILOSOPHY</span><h2>Keep the detail close.<br/><em>Make the view clearer.</em></h2></div><div><p>Morgan brings records into a workspace where activity can be reviewed, changes can be traced back to evidence, and cash estimates can be explored through visible assumptions.</p><p>Financial calculations are made by the application from stored data. Morgan Intelligence can explain that context, but AI does not create or change the underlying financial records.</p></div></section>
      <section className="mx-about-principles"><span className="mx-kicker">WHAT GUIDES THE PRODUCT</span><div><article><b>01</b><h3>Traceable</h3><p>Summaries should lead back to the records that support them.</p></article><article><b>02</b><h3>Explicit</h3><p>Recorded values and future estimates should look and read differently.</p></article><article><b>03</b><h3>Useful</h3><p>Show the context a business owner needs to review, not noise for its own sake.</p></article><article><b>04</b><h3>Complementary</h3><p>Work alongside accounting software and professional advice.</p></article></div></section>
      <section className="mx-about-close"><p>Clarity without shortcuts.<br/><em>Confidence without overstatement.</em></p><Link className="mx-button mx-button-dark" to="/signup">Explore Morgan <Icon name="upRight" size={15}/></Link></section>
    </div>
  );
}

export function Resources() {
  useDocumentTitle('Financial management resources for agencies', 'Practical guides to agency cash position, receivables aging, cash-flow assumptions, document review and monthly financial reviews.');
  const [category, setCategory] = useState('All field notes');
  const categories = ['All field notes', 'Cash & planning', 'Records & review'];
  const visibleGuides = guides.filter((g) => category === 'All field notes' || (category === 'Cash & planning' ? ['cash-position', 'forecast-assumptions', 'business-planning'].includes(g.slug) : ['receivables-aging', 'document-review', 'monthly-review'].includes(g.slug)));
  return (
    <div className="page mx-resources-page">
      <PageIntro eyebrow="Resources / Field notes" title={<>Useful context for the <span className="serif gold">numbers behind your business.</span></>} lead="Practical guides to cash, obligations, records and estimates. General information, not accounting or financial advice." />
      <nav className="mx-resource-cats" aria-label="Resource categories">{categories.map((c) => <button type="button" key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</nav>
      <ol className="guide-list">
        {visibleGuides.map((g, i) => (
          <li key={g.slug}>
            <Link to={`/resources/${g.slug}`}>
              <span className="gl-n num">0{i + 1}</span>
              <span className="gl-body"><b>{g.card}</b><span>{g.intro}</span></span>
              <span className="gl-meta">4 min read <Icon name="upRight" size={15} className="arrow" /></span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ResourceDetail() {
  const { slug } = useParams();
  const g = guides.find((x) => x.slug === slug);
  useDocumentTitle(g?.title || 'Resources', g?.intro || 'Financial management guides from Morgan.', { indexable: Boolean(g) });
  if (!g) return <Navigate to="/resources" replace />;
  return (
    <article className="page article">
      <Link className="link back" to="/resources"><Icon name="arrowLeft" size={15} className="arrow back-arrow" />All guides</Link>
      <h1>{g.title}</h1>
      <span className="folio">Field notes <b>4 min read</b></span>
      <p className="lead">{g.intro}</p>
      <ol className="article-steps">
        {g.sections.map(([h, p], i) => <li key={h}><span className="num">0{i + 1}</span><div><h2>{h}</h2><p>{p}</p></div></li>)}
      </ol>
      <p className="fine">General educational information only.</p>
    </article>
  );
}

export function Faq() {
  useDocumentTitle('Morgan FAQ', 'Answers about Morgan’s financial workflows, data sources, invoicing, reports, account security and proposed pricing.');
  return (
    <div className="page narrow">
      <PageIntro eyebrow="FAQ" title={<>Questions, <span className="serif gold">answered plainly.</span></>} lead="What Morgan does today, how your data is handled, and what is still being decided." />
      {faqs.map(([group, items]) => (
        <section key={group} className="faq-group">
          <h2>{group}</h2>
          {items.map(([q, a]) => (
            <details key={q} className="faq">
              <summary>{q}<Icon name="plus" size={16} /></summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

export function Contact() {
  useDocumentTitle('Contact Morgan', 'Contact information for Morgan product questions and feedback.', { indexable: false });
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    let active = true;
    fetch('/api/contact/status').then((r) => r.json()).then((r) => { if (active) setAvailable(r.available === true); }).catch(() => { if (active) setAvailable(false); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setFeedback(null);
    setSending(true);
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-morgan-csrf': '1' }, body: JSON.stringify({ name: form.get('name'), email: form.get('email'), topic: form.get('topic'), message: form.get('message'), website: form.get('website') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || result.message || 'Morgan could not send your message. Try again later.');
      setFeedback({ type: 'success', text: 'Your message was accepted. The team can reply to the email address you provided.' });
      formElement.reset();
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Morgan could not send your message. Try again later.' });
    } finally { setSending(false); }
  }
  return (
    <div className="page mx-contact-page">
      <PageIntro eyebrow="Contact / Start a conversation" title={<>Get in touch <span className="serif gold">with Morgan.</span></>} lead="Product questions, technical support, partnerships or feedback. Messages are routed to the Morgan contact inbox when it is configured." />
      <section className="mx-contact-layout"><div className="mx-contact-context"><span className="mx-kicker">HOW TO REACH US</span><h2>Tell us what you need.</h2><p>Choose a topic and include the context that will help us understand your message. Do not include passwords, bank credentials or full payment information.</p><div className="mx-contact-reassure"><span>01</span><p>Messages use a monitored contact inbox configured by the Morgan team.</p></div><div className="mx-contact-reassure"><span>02</span><p>Your email is used to reply to this message.</p></div></div>
        {checking ? <div className="mx-contact-unavailable" aria-live="polite">Checking contact availability…</div> : available ? <form className="mx-contact-form" onSubmit={submit}>
          <div className="mx-contact-fields"><label>Name<input name="name" autoComplete="name" required maxLength={100} /></label><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label></div>
          <label>Topic<select name="topic" required defaultValue=""><option value="" disabled>Select a topic</option><option>Product question</option><option>Technical support</option><option>Partnership</option><option>Other</option></select></label>
          <label>Message<textarea name="message" required minLength={10} maxLength={4000} rows={6} placeholder="How can we help?" /></label>
          <label className="mx-honeypot" aria-hidden="true" tabIndex={-1}>Leave this field empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <p className="mx-contact-privacy">By sending this message, you ask Morgan to use your email to reply. Avoid sharing sensitive financial or account credentials.</p>
          <button className="mx-button mx-button-primary" type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send message'} <Icon name="upRight" size={15}/></button>
          {feedback && <p className={`mx-contact-feedback ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
        </form> : <div className="mx-contact-unavailable"><Icon name="mail" size={20}/><div><h2>Contact form temporarily unavailable</h2><p>The team has not configured a monitored contact inbox yet. See the FAQ for product information, or try again later.</p><Link className="mx-text-link" to="/faq">Visit the FAQ <Icon name="arrowRight" size={14}/></Link></div></div>}
      </section>
    </div>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found', 'This Morgan page could not be found.', { indexable: false });
  return (
    <div className="page narrow" style={{ textAlign: 'center' }}>
      <div className="eyebrow gold">404</div>
      <h1 style={{ fontSize: 44, margin: '12px 0' }}>This page <span className="serif gold">doesn’t balance.</span></h1>
      <p className="lead" style={{ margin: '0 auto 24px' }}>The page you’re looking for doesn’t exist or has moved.</p>
      <Link className="btn primary" to="/">Back to home</Link>
    </div>
  );
}
