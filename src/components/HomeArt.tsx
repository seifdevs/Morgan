import { useRef } from 'react';
import { m, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { useInView } from '../lib/hooks';

/*
  Two home-page pieces that demonstrate a claim rather than decorate it.
  AuditTrail: a ledger excerpt in which Morgan's cost flags are drawn as margin brackets,
  each with its evidence. InkPencil: the principle's two strokes, drawn by scrolling.
  Sample entries.
*/
const ROWS = [
  { d: 'Sep 16', who: 'Figma', what: 'Software', amt: '−150.00', flag: 'price-a' },
  { d: 'Oct 09', who: 'West & Pine', what: 'Supplies', amt: '−412.50', flag: 'dup' },
  { d: 'Oct 10', who: 'West & Pine', what: 'Supplies', amt: '−412.50', flag: 'dup' },
  { d: 'Oct 15', who: 'Meridian Labs', what: 'Retainer', amt: '+11,200.00' },
  { d: 'Oct 16', who: 'Figma', what: 'Software', amt: '−180.00', flag: 'price-b' },
  { d: 'Oct 18', who: 'Harbor Workspace', what: 'Rent', amt: '−1,850.00' },
  { d: 'Oct 20', who: 'Gusto', what: 'Payroll', amt: '−14,200.00' },
];
const EASE = [0.16, 1, 0.3, 1] as const;

export function AuditTrail() {
  const reduced = !!useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const go = reduced || inView;
  const mark = (delay: number) => ({ initial: reduced ? false : { scaleY: 0 }, animate: go ? { scaleY: 1 } : undefined, transition: { delay, duration: 0.6, ease: EASE } });
  const note = (delay: number) => ({ initial: reduced ? false : { opacity: 0, x: -8 }, animate: go ? { opacity: 1, x: 0 } : undefined, transition: { delay, duration: 0.5, ease: EASE } });
  return (
    <div className="audit" ref={ref} aria-label="Sample ledger excerpt with two cost flags">
      <ol className="audit-rows">
        {ROWS.map((r, i) => (
          <li key={i} className={r.flag ? `flagged ${r.flag}` : ''}>
            <span className="mono">{r.d}</span><span className="who">{r.who}<small>{r.what}</small></span><b className="num">{r.amt}</b>
          </li>
        ))}
      </ol>
      {/* Margin brackets: rows 2–3 (duplicate) and rows 1 & 5 (price increase). Positions follow the 56px row rhythm. */}
      <m.span className="audit-bracket dup" style={{ originY: 0 }} {...mark(0.15)} aria-hidden="true" />
      <m.div className="audit-note dup" {...note(0.55)}>
        <b>Possible duplicate</b>
        <span>Same vendor, same amount, one day apart. If confirmed, a refund recovers <em className="num">$412.50</em>.</span>
      </m.div>
      <m.span className="audit-bracket price" style={{ originY: 0 }} {...mark(0.85)} aria-hidden="true" />
      <m.div className="audit-note price" {...note(1.2)}>
        <b>Price increase</b>
        <span>Figma: <em className="num">$150.00</em> → <em className="num">$180.00</em>. Confirm the change was expected.</span>
      </m.div>
      <p className="audit-caption mono">Sample entries · flags link to the transactions behind them</p>
    </div>
  );
}

/** The principle, demonstrated: scrolling inks a solid line, then the same line continues in pencil. */
export function InkPencil() {
  const reduced = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 45%'] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });
  const ink = useTransform(p, [0, 0.6], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']);
  const pencil = useTransform(p, [0.55, 1], ['inset(0 100% 0 0)', 'inset(0 0% 0 0)']);
  return (
    <div className="inkpencil" ref={ref} aria-hidden="true">
      <div className="ip-row"><m.i className="ip-ink" style={{ clipPath: reduced ? 'none' : ink }} /><span>Recorded — from your transactions</span></div>
      <div className="ip-row"><m.i className="ip-pencil" style={{ clipPath: reduced ? 'none' : pencil }} /><span>Estimate — assumptions shown</span></div>
    </div>
  );
}
