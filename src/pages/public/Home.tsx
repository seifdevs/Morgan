import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CashFlowRiver } from '../../components/illustrations/Illustrations';
import { LedgerHero } from '../../components/LedgerHero';
import { MoneyFlow } from '../../components/MoneyFlow';
import { Icon } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';
import founderSvg from '../../assets/founder.svg?raw';

const homeSchema = [
  { '@type': 'Organization', name: 'Morgan', url: 'https://morganhq.site/', logo: 'https://morganhq.site/favicon.svg', description: 'Financial management and business insight for marketing and digital agencies.' },
  { '@type': 'WebSite', name: 'Morgan', url: 'https://morganhq.site/' },
];

function useWhatWeDoReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      setRevealed(true);
    }, { threshold: 0.18 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, revealed };
}

function InstrumentRing({ kind }: { kind: 'bookkeeping' | 'morgan' | 'financial-stack' }) {
  const ticks = Array.from({ length: 20 }, (_, index) => index);
  return (
    <svg className={`what-instrument ${kind === 'morgan' ? 'instrument-center' : ''}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`what-gold-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C9A86A" stopOpacity=".12" />
          <stop offset=".48" stopColor="#C9A86A" stopOpacity=".82" />
          <stop offset="1" stopColor="#C9A86A" stopOpacity=".18" />
        </linearGradient>
      </defs>
      <circle className="instrument-track" cx="60" cy="60" r="56" />
      <circle className="instrument-inner-track" cx="60" cy="60" r="52" />
      <g className="instrument-ticks">
        {ticks.map((tick) => <line key={tick} x1="60" y1={tick % 5 === 0 ? '1.5' : '2.5'} x2="60" y2={tick % 5 === 0 ? '5.5' : '4.5'} transform={`rotate(${tick * 18} 60 60)`} />)}
      </g>
      <g className="instrument-orbit">
        <circle className="instrument-accent-ring" cx="60" cy="60" r="54" stroke={`url(#what-gold-${kind})`} />
        <circle className="instrument-highlight" cx="60" cy="6" r="1.7" />
        <circle className="instrument-highlight-glow" cx="60" cy="6" r="3.6" />
      </g>
    </svg>
  );
}

function InstrumentCircle({
  kind,
  headline,
  title,
  description,
}: {
  kind: 'bookkeeping' | 'morgan' | 'financial-stack';
  headline: string;
  title: string;
  description: string;
}) {
  return (
    <article className={`what-circle ${kind === 'morgan' ? 'what-center' : 'what-side'} ${kind}`}>
      <InstrumentRing kind={kind} />
      <span className="what-percent">{headline}</span>
      <span className="what-kicker">{title}</span>
      {kind === 'morgan' && <h3>Morgan. One workspace.</h3>}
      <p>{description}</p>
    </article>
  );
}

/*
  Scroll is time. Above the money-flow statement the page is in ink (what Morgan records);
  the statement itself crosses TODAY; below it the page is in pencil (principle, proposed
  pricing, what comes next). Section rules follow suit: solid above, dashed below.
*/
export default function Home() {
  useDocumentTitle('Financial management software for agencies', 'Financial management software for US marketing and digital agencies. Organize cash, invoices, expenses, receivables and payables, then review agency cash flow and profitability with records in view.', { schema: homeSchema });
  const whatWeDo = useWhatWeDoReveal();
  return (
    <div className="home">
      <LedgerHero />

      <section className="hz ink what-we-do" aria-labelledby="what-title">
        <header className="what-intro">
          <h2 id="what-title">What we do</h2>
          <p>Morgan helps businesses track their finances, manage invoices, understand cash flow, and make better decisions using their financial data.</p>
        </header>

        <div ref={whatWeDo.ref} className={`what-circles${whatWeDo.revealed ? ' is-visible' : ''}`} role="group" aria-label="Bookkeeping administration, Morgan financial tools, and a clearer financial workflow">
          <InstrumentCircle
            kind="bookkeeping"
            headline="RECORDS, ORGANIZED"
            title="BOOKKEEPING ADMIN"
            description="Keep invoices, bills, and financial records together. Morgan complements professional bookkeeping, reconciliations, and tax preparation."
          />
          <InstrumentCircle
            kind="morgan"
            headline="ONE WORKSPACE"
            title="MORGAN"
            description="Track income and expenses, manage invoices and records, understand cash flow, and review business performance with the underlying activity close by."
          />
          <InstrumentCircle
            kind="financial-stack"
            headline="FINANCIAL TOOLS"
            title="A CLEARER REVIEW"
            description="Review spending, receivables, bills, and cash estimates together. Morgan works alongside your accounting software and financial professionals."
          />
        </div>

        <p className="what-bottomline">One workspace. Less admin. A clearer picture of your money.</p>
        <details className="what-caveat">
          <summary>About price comparisons</summary>
          <p>The example prices provided are hypothetical: bookkeeping $850/month; accounting software $140; expense management $32; accounts-payable tools $55; and reporting $100. The proposed price-only comparisons are ($850 − $199.99) ÷ $850, ($1,177 − $199.99) ÷ $1,177, and ($327 − $49.99) ÷ $327. Morgan Business ($199.99/month) and Pro ($49.99/month) are planned prices; paid plans are not available today. Morgan does not claim to replace professional bookkeeping, reconciliations, tax preparation, or every software tool in those examples. We have not presented the calculations as savings because comparable service coverage and replaceable subscriptions have not been verified.</p>
        </details>
      </section>

      <section className="hz ink hz-owner" aria-labelledby="inv-title">
        <div className="hz-art"><CashFlowRiver /></div>
        <div className="hz-copy mnote-host">
          <h2 id="inv-title">A clearer view of<br /><span className="serif gold">the whole business.</span></h2>
          <span className="folio mnote">N°03 <b>For the person running it</b></span>
          <p>Bring income, spending, invoices and upcoming obligations into one review. Follow the summary back to its records, then decide what deserves your attention.</p>
          <ul className="owner-benefits">
            <li><b>Keep records together.</b><span>Create invoices, record payments and review bills by due date.</span></li>
            <li><b>See the movement.</b><span>Compare recorded income and costs, then inspect the entries behind a change.</span></li>
            <li><b>Look ahead carefully.</b><span>Review a cash estimate with listed invoices, obligations and timing assumptions in view.</span></li>
          </ul>
          <Link className="link" to="/features">Explore the Morgan workspace<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </div>
      </section>

      <MoneyFlow />

      <section className="hz pencil hz-principle" aria-labelledby="principle-title">
        <div className="mnote-host principle-copy">
          <span className="folio mnote">N°05 <b>Clear context</b></span>
          <h2 id="principle-title">Know what is recorded.<br /><span className="serif gold">Know what is estimated.</span></h2>
          <p className="hz-lead">Your cash balance and recorded activity come from your records. A cash-flow projection extends those records using visible timing and assumptions. Morgan keeps the two distinct, so you can review the inputs before relying on an estimate.</p>
          <Link className="link" to="/features#cashflow">See how cash-flow estimates work<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </div>
      </section>

      <section id="plans" className="hz pencil hz-pricing" aria-labelledby="price-title">
        <header className="mnote-host">
          <h2 id="price-title">A clear plan.<br /><span className="serif">No surprises.</span></h2>
          <span className="folio mnote">N°06 <b>Plans at a glance</b></span>
          <p className="hz-lead">Create an account and use Morgan free today. Pro and Business pricing are planned; paid checkout and plan-specific access are not active yet.</p>
          <Link className="link" to="/pricing">See pricing details<Icon name="arrowRight" size={15} className="arrow" /></Link>
        </header>
        <dl className="draft-plans">
          <div><dt>Free</dt><dd><span className="num">$0</span><small>/ month · available now</small></dd><p>Use the current Morgan workspace with no payment details.</p><Link className="link" to="/signup">Create free account<Icon name="arrowRight" size={15} className="arrow" /></Link></div>
          <div id="pro"><dt>Pro</dt><dd><span className="num">$49.99</span><small>/ month · planned price</small></dd><p>Paid access is not enabled. Current features are not gated by plan.</p><Link className="link" to="/pricing#pro">Plan details<Icon name="arrowRight" size={15} className="arrow" /></Link></div>
          <div id="business"><dt>Business</dt><dd><span className="num">$199.99</span><small>/ month · planned price</small></dd><p>Paid access is not enabled. Current features are not gated by plan.</p><Link className="link" to="/pricing#business">Plan details<Icon name="arrowRight" size={15} className="arrow" /></Link></div>
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
        <div className="h-close-row">
          <h2 id="close-title">See your finances clearly. <span className="serif gold">Start with your records.</span></h2>
          <div>
            <Link className="btn primary lg" to="/signup">Create your account <Icon name="upRight" size={15} className="arrow" /></Link>
            <p className="fine">No payment details required. Paid checkout is not active.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
