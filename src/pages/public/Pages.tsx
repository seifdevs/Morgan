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
  useDocumentTitle('Product');
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
  useDocumentTitle('Pricing');
  const rows = [
    ['Transactions, CSV import & spending analysis', 'Included', 'Included'],
    ['Invoices, PDF export & payment tracking', 'Included', 'Included'],
    ['Receivables & bills', 'Included', 'Included'],
    ['Overview & monthly reports', 'Included', 'Included'],
    ['Cash-flow projection & scenarios', 'Included today', 'Proposed inclusion'],
    ['Bank & accounting integrations', 'Not available', 'Not available'],
  ];
  return (
    <div className="page">
      <PageIntro eyebrow="Pricing · Proposed plans" title={<>A clear place to start. <span className="serif gold">Room to grow.</span></>} lead="Morgan’s plan structure and pricing are still being shaped. The figures below are proposals, not confirmed offers or active subscriptions." />
      <div className="plans">
        <article className="plan">
          <div className="plan-top"><h2>Free</h2><span className="badge draft">Proposed</span></div>
          <div className="plan-price"><span className="num">$0</span><small>/ month</small></div>
          <p>For businesses that want a clearer view of records, cash and obligations.</p>
          <ul className="ticks"><li>All current workspace features</li><li>Unlimited records during early access</li><li>CSV import and export</li></ul>
          <Link className="btn outline" to="/signup">Create account</Link>
        </article>
        <article className="plan pro">
          <div className="plan-top"><h2>Professional</h2><span className="badge estimate">Proposed</span></div>
          <div className="plan-price"><span className="num">$49.99</span><small>/ month</small></div>
          <p>A proposed next step for growing businesses that need deeper analysis and planning.</p>
          <ul className="ticks"><li>Everything in Free</li><li>Extended scenario planning</li><li>More detailed financial analysis</li></ul>
          <Link className="btn primary" to="/signup">Start free today</Link>
        </article>
      </div>
      <p className="fine center">No paid plan is available for purchase. Feature access, limits and billing terms have not been finalised.</p>
      <div className="panel table-wrap" style={{ marginTop: 40 }}>
        <table className="table">
          <thead><tr><th>Capability</th><th>Free (proposed)</th><th>Professional (proposed)</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((v, i) => <td key={i} className={i ? 'muted' : ''}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function About() {
  useDocumentTitle('About');
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
  useDocumentTitle('Resources');
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
  useDocumentTitle(g?.title || 'Resources');
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
  useDocumentTitle('FAQ');
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
  useDocumentTitle('Contact');
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
  useDocumentTitle('Not found');
  return (
    <div className="page narrow" style={{ textAlign: 'center' }}>
      <div className="eyebrow gold">404</div>
      <h1 style={{ fontSize: 44, margin: '12px 0' }}>This page <span className="serif gold">doesn’t balance.</span></h1>
      <p className="lead" style={{ margin: '0 auto 24px' }}>The page you’re looking for doesn’t exist or has moved.</p>
      <Link className="btn primary" to="/">Back to home</Link>
    </div>
  );
}
