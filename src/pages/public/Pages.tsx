import { Link, Navigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { CashFlowRiver, InvoiceFlow, SpendingLens } from '../../components/illustrations/Illustrations';
import { useDocumentTitle } from '../../lib/hooks';
import { faqs, guides } from './content';
import founderSvg from '../../assets/founder.svg?raw';

function PageIntro({ eyebrow, title, lead }: { eyebrow: string; title: React.ReactNode; lead: React.ReactNode }) {
  return (
    <header className="page-intro">
      <div className="pi-title mnote-host"><h1>{title}</h1><span className="folio mnote">{eyebrow}</span></div>
      <p className="lead">{lead}</p>
    </header>
  );
}

const modules = [
  { id: 'spending', icon: 'pie', title: 'Spending analysis', lead: 'Know exactly where money goes.', points: ['Search and filter every transaction by date, vendor, category and type', 'Category and vendor breakdowns compared with the previous period', 'Cumulative spend curve: this period against last', 'Drill from any breakdown straight into the transactions behind it'], art: <SpendingLens /> },
  { id: 'invoicing', icon: 'document', title: 'Invoicing & billing', lead: 'Invoices that add up — to the cent.', points: ['Line items with quantities, discounts and tax in integer-cent math', 'Live paper-style preview while you edit', 'PDF export; email delivery when an email provider is configured', 'Record full or partial payments, which flow into your cash records'], art: <InvoiceFlow /> },
  { id: 'cashflow', icon: 'trend', title: 'Cash-flow planning', lead: 'Look ahead with assumptions you can inspect.', points: ['13-week projection from open invoices and unpaid bills by due date', 'Optional run-rate from your recent recorded activity', 'Simple what-if adjustments that never overwrite your records', 'Recorded and estimated figures are always visually distinct'], art: <CashFlowRiver /> },
];

export function Features() {
  useDocumentTitle('Financial management features for agencies', 'Explore Morgan workflows for agency spending analysis, invoices, bills, receivables, reports and cash-flow estimates.', { canonicalPath: '/features' });
  return (
    <div className="page">
      <PageIntro eyebrow="The Morgan platform" title={<>Make the financial picture <span className="serif gold">easier to follow.</span></>} lead="Spending, invoices, receivables, bills and cash flow share one workspace — and every summary links back to the records behind it." />
      <nav className="module-nav" aria-label="Modules">{modules.map((m, i) => <a key={m.id} href={`#${m.id}`}><span>0{i + 1}</span>{m.title}</a>)}</nav>
      {modules.map((m, i) => (
        <section key={m.id} id={m.id} className={`module ${i % 2 ? 'reverse' : ''}`}>
          <div className="module-copy">
            <span className="module-icon"><Icon name={m.icon} size={20} /></span>
            <h2>{m.title}</h2>
            <p className="module-lead">{m.lead}</p>
            <ul className="ticks">{m.points.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
          <div className="module-art">{m.art}</div>
        </section>
      ))}
      <section className="also">
        <h2>Also in the workspace</h2>
        <div className="also-grid">
          <div><Icon name="receivable" /><h3>Receivables</h3><p>Aging buckets, overdue totals and the oldest invoices first.</p></div>
          <div><Icon name="payable" /><h3>Bills</h3><p>Upcoming obligations; paying a bill records the expense automatically.</p></div>
          <div><Icon name="spark" /><h3>Insights</h3><p>Duplicate charges, recurring costs and price increases — each with evidence.</p></div>
          <div><Icon name="report" /><h3>Reports</h3><p>Monthly profit &amp; loss by category, exportable to CSV.</p></div>
        </div>
      </section>
      <section className="cta-band"><h2>See it with <span className="serif gold">your numbers.</span></h2><Link className="btn primary lg" to="/signup">Create your free account <Icon name="upRight" size={15} className="arrow" /></Link></section>
    </div>
  );
}

export function Pricing() {
  useDocumentTitle('Pricing', 'Morgan is free to use today. Review planned Pro and Business monthly prices and what is currently available.');
  const plans = [
    { id: 'free', name: 'Free', price: '$0', state: 'Available now', summary: 'Start organizing the finances already in your records.', action: 'Create free account', to: '/signup', featured: false },
    { id: 'pro', name: 'Pro', price: '$49.99', state: 'Planned price', summary: 'A proposed paid tier for businesses reviewing their finances regularly.', action: 'Explore current access', to: '#current-access', featured: true },
    { id: 'business', name: 'Business', price: '$199.99', state: 'Planned price', summary: 'A proposed tier for businesses with broader financial oversight needs.', action: 'Explore current access', to: '#current-access', featured: false },
  ];
  return (
    <div className="page">
      <PageIntro eyebrow="Plans & pricing" title={<>Straightforward pricing. <span className="serif gold">Transparent status.</span></>} lead="Morgan is free to use today. Pro is planned at $49.99 per month and Business at $199.99 per month; paid billing is not active yet." />
      <div className="plans pricing-plans">
        {plans.map((plan) => (
          <article className={`plan ${plan.featured ? 'pro' : ''}`} id={plan.id} key={plan.id}>
            <div className="plan-top"><h2>{plan.name}</h2><span className={`badge ${plan.id === 'free' ? 'available' : 'estimate'}`}>{plan.state}</span></div>
            <div className="plan-price"><span className="num">{plan.price}</span><small>/ month</small></div>
            <p>{plan.summary}</p>
            <ul className="ticks">
              {plan.id === 'free' ? <><li>Transactions, CSV import and spending analysis</li><li>Invoices, PDF export and payment tracking</li><li>Receivables, bills, reports and cash estimates</li></> : <><li>Current workspace features remain available</li><li>No paid access or plan-specific features are active</li><li>No charge is made when you create an account</li></>}
            </ul>
            <Link className={`btn ${plan.featured ? 'primary' : 'outline'}`} to={plan.to}>{plan.action}</Link>
          </article>
        ))}
      </div>
      <section id="current-access" className="pricing-current panel">
        <div><span className="eyebrow gold">What is available today</span><h2>One complete workspace, free to start.</h2><p>Morgan currently provides the same available product features to every account. Pro and Business prices are planned, but there is no checkout, subscription, usage limit or feature gate tied to those plans today.</p></div>
        <ul className="ticks"><li>Track transactions with CSV import and spending analysis</li><li>Create invoices, export PDFs and record payments</li><li>Review receivables, bills and monthly reports</li><li>Explore a 13-week cash estimate and scenarios</li></ul>
        <p className="fine">Morgan works alongside accounting software and professional advice. Cash projections are estimates based on recorded activity and stated assumptions.</p>
      </section>
    </div>
  );
}

export function About() {
  useDocumentTitle('About Morgan', 'Learn why founder Seif is building Morgan as a practical financial management and insight layer for small and growing businesses.');
  return (
    <div className="page">
      <PageIntro eyebrow="About Morgan" title={<>Make business finances <span className="serif gold">make more sense.</span></>} lead="Morgan exists to help business owners see their financial position more clearly and understand the information behind the decisions they make." />
      <section className="about-vision">
        <h2>Clarity should come with context.</h2>
        <p>Small and growing businesses work with a steady flow of invoices, expenses, payment dates and open questions. Morgan brings those records into an understandable view — so people can make informed decisions with their own business context in hand. It is designed as a complementary layer alongside accounting software and professional advice.</p>
      </section>
      <section className="founder about-founder">
        <div className="founder-art"><div className="founder-portrait" dangerouslySetInnerHTML={{ __html: founderSvg }} /></div>
        <div className="founder-copy">
          <div className="eyebrow gold">Founder · Seif</div>
          <h2>Clarity without shortcuts.</h2>
          <p>Seif is building Morgan around an unusually clear ambition: make the financial picture easier to understand, without hiding the details that matter. Morgan reflects his conviction that business owners deserve more than a pile of disconnected figures.</p>
          <p>His standard is refreshingly direct: confidence without overstatement, and thoughtful design in service of the person running the business.</p>
        </div>
      </section>
    </div>
  );
}

export function Resources() {
  useDocumentTitle('Financial management resources for agencies', 'Practical guides to agency cash position, receivables aging, cash-flow assumptions, document review and monthly financial reviews.');
  return (
    <div className="page">
      <PageIntro eyebrow="Morgan field notes" title={<>Useful context for the <span className="serif gold">numbers behind your business.</span></>} lead="Practical guides to cash, obligations, records and estimates. General information, not accounting or financial advice." />
      <ol className="guide-list">
        {guides.map((g, i) => (
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
  return (
    <div className="page narrow">
      <PageIntro eyebrow="Contact" title={<>Get in touch <span className="serif gold">with Morgan.</span></>} lead="For product questions, partnerships or feedback, use the Morgan contact channel that was shared with you directly." />
      <div className="panel contact-panel">
        <Icon name="mail" size={22} />
        <div>
          <h2>No public contact address is configured yet</h2>
          <p className="muted">We haven’t added a message form because there is no monitored inbox to deliver it to — we’d rather not collect messages nobody reads.</p>
        </div>
      </div>
      <div className="contact-links">
        <Link className="btn outline" to="/faq">Visit the FAQ</Link>
        <Link className="btn outline" to="/resources">Browse guides</Link>
      </div>
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
