import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

type AgencyPage = {
  title: string;
  description: string;
  eyebrow: string;
  heading: React.ReactNode;
  lead: string;
  sections: { title: string; body: string; bullets: string[] }[];
  links: { label: string; to: string }[];
};

const pages: Record<string, AgencyPage> = {
  management: {
    title: 'Financial management for agencies',
    description: 'A practical financial management workspace for marketing and digital agencies. Organize invoices, expenses, receivables, bills and cash-flow estimates together.',
    eyebrow: 'For marketing & digital agencies',
    heading: <>Financial management for agencies, <span className="serif gold">with the records in view.</span></>,
    lead: 'A 5–30 person agency has client invoices, payroll, contractor costs and supplier bills moving on different schedules. Morgan brings those records into one place to make the operating picture easier to review.',
    sections: [
      { title: 'Keep money owed and money due visible', body: 'Review open client invoices alongside upcoming agency obligations, with dates and statuses close to the underlying record.', bullets: ['Track invoices and recorded payments', 'Review receivables by age and due date', 'Keep bills and upcoming obligations in view'] },
      { title: 'Understand the cost picture', body: 'Compare income and categorized spending over time, then open the transactions behind a change. Use the view as a starting point for a monthly review.', bullets: ['Search expenses by vendor, date and category', 'Compare category and vendor totals with the prior period', 'Export monthly reports for further review'] },
      { title: 'Plan with assumptions you can inspect', body: 'Morgan estimates a 13-week cash path from open invoices and bills. Optional run-rate and scenario adjustments are estimates, so they remain distinct from recorded balances.', bullets: ['See expected inflows and outflows by due date', 'Explore a delayed client payment or planned hire', 'Review assumptions before relying on an estimate'] },
    ],
    links: [{ label: 'Agency cash-flow planning', to: '/agency-cash-flow' }, { label: 'Agency profitability review', to: '/agency-profitability' }],
  },
  cashflow: {
    title: 'Cash-flow management for agencies',
    description: 'Explore agency cash flow with open invoices, unpaid bills and an inspectable 13-week estimate. Learn what the forecast includes and what it leaves out.',
    eyebrow: 'Agency cash-flow management',
    heading: <>A clearer agency cash-flow view, <span className="serif gold">week by week.</span></>,
    lead: 'Client payment timing and recurring agency costs rarely line up neatly. Morgan puts the dates you have recorded into a 13-week estimate, so the near-term picture can be reviewed alongside its assumptions.',
    sections: [
      { title: 'Start with the records you have', body: 'The projection uses your starting cash position, open invoices and unpaid bills. Due dates inform timing; an open invoice is still a receivable, not cash in hand.', bullets: ['Set an opening balance and date', 'Add or import transactions and obligations', 'Check invoice and bill dates before projecting'] },
      { title: 'Look at timing, not just totals', body: 'An agency can be profitable over a month and still have a tight week if a large client payment is late. A week-by-week estimate helps surface timing differences for review.', bullets: ['See estimated cash movement over 13 weeks', 'Keep estimates visually separate from recorded amounts', 'Follow projection entries back to the relevant records'] },
      { title: 'Test a scenario carefully', body: 'Adjust an assumption such as a delayed client payment, an expected cost or a planned hire. Scenarios are planning aids; they do not predict what a client or supplier will do.', bullets: ['Change one assumption at a time', 'Compare the scenario with the baseline estimate', 'Update the underlying records when circumstances change'] },
    ],
    links: [{ label: 'Financial management for agencies', to: '/agency-financial-management' }, { label: 'Read about forecasts', to: '/features#cashflow' }],
  },
  profitability: {
    title: 'Profitability tracking for agencies',
    description: 'Review agency income and categorized expenses over time with Morgan. Understand the current limits of business-level reporting and how to prepare records for a useful review.',
    eyebrow: 'Agency profitability tracking',
    heading: <>See what is changing in agency costs, <span className="serif gold">not just the top line.</span></>,
    lead: 'For a small agency, profitability review starts with a consistent view of recorded income and costs. Morgan helps compare expense categories and vendors over time and trace a change back to its transactions.',
    sections: [
      { title: 'Build a useful business-level review', body: 'Use invoices, recorded payments and categorized spending to review income and costs for a period. Confirm the date range and that the records you need are present before drawing conclusions.', bullets: ['Review monthly income and expense reports', 'Compare categories and vendors with the prior period', 'Export report data for your accountant or finance lead'] },
      { title: 'Trace unusual movement', body: 'When a cost category or vendor changes, open the contributing transactions and review the source records. A flagged change is a prompt to investigate, not proof that an expense is wrong.', bullets: ['Search and filter transactions', 'Review possible duplicates and recurring charges', 'Keep estimates and recorded activity clearly distinguished'] },
      { title: 'Know the current scope', body: 'Morgan currently supports business-level reporting by category. It does not calculate project margins, client profitability, utilization or staff capacity. Those analyses require project and delivery data that Morgan does not currently collect.', bullets: ['Use consistent categories for comparable periods', 'Add context outside Morgan for client or project margin analysis', 'Treat reports as a management view, not a substitute for accounting advice'] },
    ],
    links: [{ label: 'Financial management for agencies', to: '/agency-financial-management' }, { label: 'Review spending analysis', to: '/features#spending' }],
  },
};

export function AgencyPage({ topic }: { topic: keyof typeof pages }) {
  const content = pages[topic];
  useDocumentTitle(content.title, content.description);
  return (
    <article className="page agency-page">
      <header className="page-intro">
        <div className="pi-title"><span className="folio">{content.eyebrow}</span><h1>{content.heading}</h1></div>
        <p className="lead">{content.lead}</p>
      </header>
      <div className="agency-sections">
        {content.sections.map((section, index) => (
          <section className="module" key={section.title}>
            <div className="module-copy">
              <span className="module-icon"><Icon name={index === 0 ? 'receivable' : index === 1 ? 'report' : 'trend'} size={20} /></span>
              <h2>{section.title}</h2>
              <p className="module-lead">{section.body}</p>
              <ul className="ticks">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
            </div>
          </section>
        ))}
      </div>
      <aside className="panel" style={{ padding: 24, marginTop: 32 }}>
        <span className="eyebrow gold">Explore Morgan</span>
        <div className="contact-links" style={{ marginTop: 16 }}>
          {content.links.map((link) => <Link className="btn outline" key={link.to} to={link.to}>{link.label}<Icon name="arrowRight" size={15} className="arrow" /></Link>)}
          <Link className="btn primary" to="/signup">Create an account<Icon name="upRight" size={15} className="arrow" /></Link>
        </div>
      </aside>
      <p className="fine" style={{ marginTop: 20 }}>Morgan is an additional financial management layer. It works alongside accounting software and professional advice; it does not connect to banks or move money.</p>
    </article>
  );
}
