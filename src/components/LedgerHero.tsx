import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';

/*
  The Ledger Line. One full-bleed cash line runs through the hero and splits the headline:
  what you know sits above it, what you own sits below it. The line is inked in gold up to
  TODAY (where the cash figure lives) and continues in pencil. The pointer reads any week.
  Leaving the hero, the line flattens into the rule that opens the next section.
  Sample business, illustrative figures.
*/
const WEEKS = ['Aug 4', 'Aug 11', 'Aug 18', 'Aug 25', 'Sep 1', 'Sep 8', 'Sep 15', 'Sep 22', 'Sep 29', 'Oct 6', 'Oct 13', 'Oct 20', 'Oct 27', 'Nov 3', 'Nov 10', 'Nov 17'];
const BAL = [52100, 54800, 53200, 57900, 61000, 58400, 63700, 67100, 64900, 71200, 77400, 84260, 86900, 85200, 89700, 91380];
const TODAY = 11;
const POSTED = [
  { i: 7, amt: '+$11,200.00', who: 'Meridian Labs · retainer' },
  { i: 9, amt: '−$14,200.00', who: 'Gusto · payroll' },
  { i: 10, amt: '+$12,340.50', who: 'Cedar House · INV-0108' },
  { i: 11, amt: '−$1,850.00', who: 'Harbor Workspace · rent' },
];
const EASE = [0.16, 1, 0.3, 1] as const;
const VB_W = 1000, VB_H = 300, LO = 46000, HI = 96000;
const px = (i: number) => (i / (WEEKS.length - 1)) * VB_W;
const py = (v: number) => VB_H * (1 - (v - LO) / (HI - LO));
const pctX = (i: number) => (i / (WEEKS.length - 1)) * 100;
const pctY = (v: number) => (py(v) / VB_H) * 100;
const usd = (n: number) => '$' + n.toLocaleString('en-US');

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function curve(idx: number[]) {
  const p = idx.map((i) => [px(i), py(BAL[i])]);
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let k = 0; k < p.length - 1; k++) {
    const p0 = p[k - 1] || p[k], p1 = p[k], p2 = p[k + 1], p3 = p[k + 2] || p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const rec = Array.from({ length: TODAY + 1 }, (_, i) => i);
const est = Array.from({ length: WEEKS.length - TODAY }, (_, i) => i + TODAY);
const INK = curve(rec), PENCIL = curve(est);
const AREA = `${INK}L${px(TODAY)},${VB_H}L0,${VB_H}Z`;

export function LedgerHero() {
  const reduced = !!useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const init = reduced ? false : undefined;
  const at = (delay: number, duration = 0.7) => ({ delay, duration, ease: EASE });

  // Leaving the hero: the line flattens into the rule that opens the next section.
  // The hero always starts at the top of the page, so page scroll over one viewport is its exit
  // progress. (Target-based measurement went stale when web fonts reflowed the hero after mount.)
  const { scrollY } = useScroll();
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  useEffect(() => { const on = () => setVh(window.innerHeight); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const scrollYProgress = useTransform(scrollY, [0, vh], [0, 1]);
  const flatten = useTransform(scrollYProgress, [0, 0.75], [1, 0.04]);
  const lift = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const fade = useTransform(scrollYProgress, [0, 0.45], [1, 0]);
  const bandFade = useTransform(scrollYProgress, [0.3, 0.62], [1, 0]);

  // Pointer reading: nearest week, chip glides on a spring.
  const [read, setRead] = useState<number | null>(null);
  const chipX = useSpring(pctX(TODAY), { stiffness: 380, damping: 38 });
  const [fine, setFine] = useState(false);
  useEffect(() => { setFine(window.matchMedia('(hover: hover) and (pointer: fine)').matches); }, []);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!fine) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(WEEKS.length - 1, Math.round(((e.clientX - r.left) / r.width) * (WEEKS.length - 1))));
    setRead(i);
    chipX.set(pctX(i));
  };

  // A recent entry is posted along the ink every few seconds (paused offscreen and under reduced motion).
  const [post, setPost] = useState(-1);
  const [visible, setVisible] = useState(true);
  useMotionValueEvent(scrollYProgress, 'change', (p) => setVisible(p < 0.6));
  useEffect(() => {
    if (reduced || !visible) return;
    const t = setTimeout(() => setPost((p) => (p + 1) % POSTED.length), post < 0 ? 3400 : 2800);
    return () => clearTimeout(t);
  }, [post, reduced, visible]);
  const posted = post >= 0 ? POSTED[post] : null;

  return (
    <section ref={ref} className="lh" aria-labelledby="lh-title">
      <div className="lh-ruled" aria-hidden="true" />
      <h1 id="lh-title" className="lh-title">
        <m.span className="lh-l1" style={{ y: lift }}>
          <span className="lh-mask"><m.span initial={init ?? { y: '104%' }} animate={{ y: 0 }} transition={at(0.05, 0.9)}>Know your business.</m.span></span>
        </m.span>
        <span className="lh-l2 serif">
          <span className="lh-mask"><m.span initial={init ?? { y: '104%' }} animate={{ y: 0 }} transition={at(0.18, 0.9)}>Own your numbers.</m.span></span>
        </span>
      </h1>

      <m.div className="lh-band" style={{ scaleY: reduced ? 1 : flatten, opacity: reduced ? 1 : bandFade }} onPointerMove={onMove} onPointerLeave={() => { setRead(null); chipX.set(pctX(TODAY)); }}
        role="img" aria-label={`Sample business cash balance, ${WEEKS[0]} to ${WEEKS[TODAY]} recorded, rising to ${usd(BAL[TODAY])} today; estimated to ${usd(BAL[BAL.length - 1])} by ${WEEKS[WEEKS.length - 1]}.`}>
        <svg className="lh-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="lhArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c9a86a" stopOpacity=".16" /><stop offset="1" stopColor="#c9a86a" stopOpacity="0" /></linearGradient>
            {/* Ink is revealed by a moving clip edge: pathLength dashing breaks with non-scaling strokes. */}
            <clipPath id="lhInk"><m.rect x="-4" y="-10" height={VB_H + 20} initial={init ?? { width: 0 }} animate={{ width: px(TODAY) + 8 }} transition={at(0.35, 1.45)} /></clipPath>
            <clipPath id="lhPencil"><m.rect x={px(TODAY)} y="-10" height={VB_H + 20} initial={init ?? { width: 0 }} animate={{ width: VB_W - px(TODAY) + 4 }} transition={at(1.95, 0.9)} /></clipPath>
          </defs>
          <m.path d={AREA} fill="url(#lhArea)" initial={init ?? { opacity: 0 }} animate={{ opacity: 1 }} transition={at(1.1, 0.9)} />
          <g clipPath="url(#lhInk)"><path d={INK} className="lh-ink" /></g>
          <g clipPath="url(#lhPencil)"><path d={PENCIL} className="lh-pencil" /></g>
        </svg>

        {/* Week rules and month marks along the bottom of the band */}
        <div className="lh-months" aria-hidden="true">
          {WEEKS.map((w, i) => w.endsWith(' 4') || w.endsWith(' 1') || w.endsWith(' 6') || w.endsWith(' 3') ? <span key={w} style={{ left: `${pctX(i)}%` }}>{w.split(' ')[0]}</span> : null)}
        </div>

        <m.div className="lh-today" style={{ left: `${pctX(TODAY)}%` }} initial={init ?? { scaleY: 0 }} animate={{ scaleY: 1 }} transition={at(1.6, 0.5)} aria-hidden="true">
          <span className="ink">Today</span><span className="pencil">Estimate</span>
        </m.div>
        <m.span className="lh-dot" style={{ left: `${pctX(TODAY)}%`, top: `${pctY(BAL[TODAY])}%` }} initial={init ?? { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: reduced ? 0 : 1.75, type: 'spring', stiffness: 420, damping: 22 }} aria-hidden="true" />
        <m.div className="lh-figure" style={{ left: `${pctX(TODAY)}%`, top: `${pctY(BAL[TODAY])}%`, opacity: reduced ? 1 : fade }}>
          <m.div initial={init ?? { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={at(1.85, 0.6)}>
            <small>Cash on hand · recorded</small>
            <b className="num">$84,260.00</b>
          </m.div>
        </m.div>
        <m.div className="lh-end" style={{ top: `${pctY(BAL[BAL.length - 1])}%` }} initial={init ?? { opacity: 0 }} animate={{ opacity: 1 }} transition={at(2.7, 0.5)} aria-hidden="true">
          <small>{WEEKS[WEEKS.length - 1]} · estimate</small><b className="num">{usd(BAL[BAL.length - 1])}</b>
        </m.div>

        <AnimatePresence>
          {posted && !read && (
            <m.div key={posted.i} className="lh-post" style={{ left: `${pctX(posted.i)}%`, top: `${pctY(BAL[posted.i])}%` }}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ duration: 0.45, ease: EASE }} aria-hidden="true">
              <i /><span className="mono">{WEEKS[posted.i]}</span><b className="num">{posted.amt}</b><small>{posted.who}</small>
            </m.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {read !== null && <ReadLine key="read" chipX={chipX} i={read} />}
        </AnimatePresence>
      </m.div>

      <div className="lh-foot">
        <p className="lh-lead">Spending, invoices, receivables, bills and cash flow in one calm workspace — every figure traceable to the record behind it.</p>
        <p className="lh-key" aria-hidden="true">
          <span><svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="#c9a86a" strokeWidth="2.5" strokeLinecap="round" /></svg>Recorded</span>
          <span><svg width="28" height="6"><line x1="1" y1="3" x2="27" y2="3" stroke="#b9c1c7" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" /></svg>Estimate</span>
          <span className="mono">Sample business · illustrative</span>
        </p>
      </div>
    </section>
  );
}

/** Crosshair + readout that follows the pointer (spring), styled as ink or pencil for the week it reads. */
function ReadLine({ chipX, i }: { chipX: ReturnType<typeof useSpring>; i: number }) {
  const left = useTransform(chipX, (v) => `${v}%`);
  const estimate = i > TODAY;
  return (
    <m.div className={`lh-cross ${estimate ? 'est' : ''}`} style={{ left }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.15 }} aria-hidden="true">
      <span className="lh-cross-chip">
        <small>Week of {WEEKS[i]} · {estimate ? 'estimate' : i === TODAY ? 'today' : 'recorded'}</small>
        <b className="num">{usd(BAL[i])}</b>
      </span>
    </m.div>
  );
}
