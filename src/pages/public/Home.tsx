import { Link } from 'react-router-dom';
import { InvoiceFlow, LedgerTape } from '../../components/illustrations/Illustrations';
import { AuditTrail, InkPencil } from '../../components/HomeArt';
import { LedgerHero } from '../../components/LedgerHero';
import { MoneyFlow } from '../../components/MoneyFlow';
import { Icon } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import founderSvg from '../../assets/founder.svg?raw';

/*
  Scroll is time. Above the money-flow statement the page is in ink (what Morgan records);
  the statement itself crosses TODAY; below it the page is in pencil (principle, proposed
  pricing, what comes next). Section rules follow suit: solid above, dashed below.
*/
const ledgers = [
  { t: 'Spending', d: 'Every expense by vendor and category, against the period before it.', e: ['Oct 20', 'Gusto · payroll', '−14,200.00'], to: '/features#spending' },
  { t: 'Invoices', d: 'Cent-exact totals, PDF export, email when configured, payments as they land.', e: ['Oct 21', 'Cedar House · INV-0108', '+12,340.50'], to: '/features#invoicing' },
  { t: 'Receivables & bills', d: 'What you are owed and what you owe, aged by due date, overdue first.', e: ['Oct 26', 'Harbor Workspace · bill due', '−1,850.00'], to: '/features#invoicing' },
  { t: 'Cash flow', d: 'Thirteen weeks ahead from open invoices and bills — always marked as an estimate.', e: ['Nov 17', 'Projected balance', '91,380.00'], to: '/features#cashflow', est: true },
];

export default function Home() {
  useDocumentTitle('');
  return (
    <div className="home">
      <LedgerHero />

      <section className="hz ink rec" aria-labelledby="ledgers-title">
        <header className="mnote-host">
          <h2 id="ledgers-title">Four ledgers,<br /><span className="serif">one picture.</span></h2>
          <span className="folio mnote">N°02 <b>What Morgan records</b></span>
          <p className="hz-lead">Morgan reads only what you enter or import. Nothing is connected behind your back, and nothing is invented to fill a chart.</p>
        </header>
        <div className="rec-table" role="table" aria-label="The four ledgers, each with a sample entry">
          <div className="rec-row rec-head" role="row"><span role="columnheader">Ledger</span><span role="columnheader">What it keeps</span><span role="columnheader">An entry from it <i>· sample</i></span></div>
          {ledgers.map((l) => (
            <Link key={l.t} to={l.to} className={`rec-row ${l.est ? 'est' : ''}`} role="row">
              <span className="rec-t" role="cell">{l.t}</span>
              <span className="rec-d" role="cell">{l.d}</span>
              <span className="rec-e" role="cell"><span className="mono">{l.e[0]}</span><span>{l.e[1]}</span><b className="num">{l.e[2]}</b></span>
              <span className="rec-go" aria-hidden="true"><Icon name="arrowRight" size={18} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="hz ink hz-invoice" aria-labelledby="inv-title">
        <div className="hz-art"><InvoiceFlow /></div>
        <div className="hz-copy mnote-host">
          <h2 id="inv-title">From draft<br />to <span className="serif gold">paid.</span></h2>
          <span className="folio mnote">N°03 <b>Invoicing</b></span>
          <p>Line items, discounts and tax in exact cents — the server recomputes every total. Overdue comes from the due date in your time zone, never typed by hand. A payment you record becomes a transaction automatically.</p>
          <Link className="link" to="/features#invoicing">Inside the invoice editor<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </div>
      </section>

      <section className="hz ink hz-insight" aria-labelledby="ins-title">
        <div className="hz-copy mnote-host">
          <h2 id="ins-title">Insights with <span className="serif">receipts.</span></h2>
          <span className="folio mnote">N°04 <b>Cost reduction</b></span>
          <p>Possible duplicate charges, recurring costs, price increases and vendors whose spend jumped. Each flag opens the exact transactions behind it. No invented savings.</p>
        </div>
        <div className="hz-art"><AuditTrail /></div>
      </section>

      <MoneyFlow />

      <section className="hz pencil hz-principle" aria-label="Principle">
        <div className="mnote-host">
          <p className="principle">A recorded figure and an estimate should <span className="serif gold">never look the same.</span></p>
          <span className="folio mnote">N°05 <b>Principle</b></span>
        </div>
        <InkPencil />
        <p className="hz-lead">So the rest of this page is in pencil. What comes next for Morgan is a plan, not a record — and we draw it that way.</p>
      </section>

      <section className="hz pencil hz-pricing" aria-labelledby="price-title">
        <header className="mnote-host">
          <h2 id="price-title">Pricing, <span className="serif">in pencil.</span></h2>
          <span className="folio mnote">N°06 <b>Proposed plans</b></span>
          <p className="hz-lead">These figures are proposals, not offers. Nothing can be bought yet, and signing up never asks for payment details.</p>
          <Link className="link" to="/pricing">Read the full proposal<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </header>
        <dl className="draft-plans">
          <div><dt>Free</dt><dd><span className="num">$0</span><small>/ month · proposed</small></dd><p>Everything in the workspace today.</p></div>
          <div><dt>Professional</dt><dd><span className="num">$49.99</span><small>/ month · proposed, unconfirmed</small></dd><p>Deeper analysis and planning, under consideration.</p></div>
        </dl>
      </section>

      <section className="hz pencil hz-founder" aria-labelledby="founder-title">
        <div className="hz-copy mnote-host">
          <h2 id="founder-title">Big ambition.<br /><span className="serif">Clear purpose.</span></h2>
          <span className="folio mnote">N°07 <b>The founder · Seif</b></span>
          <p>Seif is building Morgan around a direct idea: make the financial picture easier to understand, without hiding the details that matter. Clarity without shortcuts, confidence without overstatement.</p>
          <Link className="link" to="/about">Read our story<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </div>
        <div className="hz-art"><div className="founder-portrait" dangerouslySetInnerHTML={{ __html: founderSvg }} /></div>
      </section>

      <section className="h-close" aria-labelledby="close-title">
        <LedgerTape />
        <div className="h-close-row">
          <h2 id="close-title">Open the ledger. <span className="serif gold">Ink your first entry.</span></h2>
          <div>
            <Link className="btn primary lg" to="/signup">Create your account <Icon name="upRight" size={15} className="arrow" /></Link>
            <p className="fine">Free while plans are finalised. No payment details.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
