import { useEffect } from 'react';
import { animate, m as motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useInView } from '../../lib/hooks';

/* All illustrations are decorative and use fixed, clearly-labelled sample figures.
   The hero sequence uses Motion; the rest are CSS. All honour prefers-reduced-motion and pause offscreen. */

/* The homepage's one authored moment — "ink and pencil", from DESIGN.md's Night Ledger:
   the recorded line is inked in gold while the cash figure follows it; a "today" rule lands;
   the estimate is pencilled in dashes behind a moving clip edge; then an invoice is stamped
   PAID and, in the same beat, cash rises by that payment. Reduced motion renders the end state. */
const EASE = [0.16, 1, 0.3, 1] as const;
const T = { ink: 0.3, inkDur: 1.7, today: 2.0, pencil: 2.15, pencilDur: 1.0, card: 0.8, stamp: 3.3 };
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const INK = 'M0 140 C40 132 60 136 90 118 S150 122 180 100 S240 108 270 84 S320 70 330 66';
const PENCIL = 'M330 66 C370 74 390 52 420 50 S460 36 480 30';

function useHeroCount(to: number, reduced: boolean, run: (mv: ReturnType<typeof useMotionValue<number>>) => () => void) {
  const mv = useMotionValue(reduced ? to : 0);
  const text = useTransform(mv, usd);
  // Runs once per mount: the sequence is the hero's entrance, not a reaction to later renders.
  useEffect(() => (reduced ? undefined : run(mv)), [reduced]);
  return text;
}

export function HeroDashboard() {
  const reduced = !!useReducedMotion();
  const { ref, offscreen } = useInView<HTMLDivElement>(0.1);
  const on = (delay: number, duration = 0.6) => ({ delay, duration, ease: EASE });
  // Two phases on one value must be chained: starting a second animation on a motion value cancels the first.
  const chain = (mv: ReturnType<typeof useMotionValue<number>>, inked: number, settled: number) => {
    let second: { stop: () => void } | undefined;
    const first = animate(mv, inked, on(T.ink, T.inkDur));
    first.then(() => { second = animate(mv, settled, on(T.stamp - T.ink - T.inkDur, 0.7)); });
    return () => { first.stop(); second?.stop(); };
  };
  // Cash follows the ink, then rises by the paid invoice when the stamp lands.
  const cash = useHeroCount(84260, reduced, (mv) => {
    return chain(mv, 80010, 84260);
  });
  const net = useHeroCount(24240, reduced, (mv) => { const c = animate(mv, 24240, on(T.ink, T.inkDur)); return () => c.stop(); });
  const owed = useHeroCount(25650, reduced, (mv) => {
    return chain(mv, 29900, 25650);
  });
  const init = reduced ? false : undefined;

  return (
    <div className="hero-art" ref={ref} data-offscreen={offscreen} aria-hidden="true">
      <div className="ha-caption mono">Illustration · sample figures</div>
      <div className="ha-main">
        <div className="ha-top"><span className="ha-dot" /><span className="ha-dot" /><span className="ha-dot" /><span className="ha-title">Overview · Sample business</span></div>
        <div className="ha-kpis">
          <div><small>Cash on hand</small><motion.b className="num">{cash}</motion.b><em className="pos">recorded</em></div>
          <div><small>Net this month</small><motion.b className="num">{net}</motion.b><em className="pos">recorded</em></div>
          <div><small>Outstanding</small><motion.b className="num">{owed}</motion.b><em className="neg">1 overdue</em></div>
        </div>
        <svg className="ha-chart" viewBox="0 0 480 170" preserveAspectRatio="none">
          <defs>
            <linearGradient id="haArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c9a86a" stopOpacity=".28" /><stop offset="1" stopColor="#c9a86a" stopOpacity="0" /></linearGradient>
            <clipPath id="haPencil"><motion.rect x="330" y="0" height="170" initial={init ?? { width: 0 }} animate={{ width: 150 }} transition={on(T.pencil, T.pencilDur)} /></clipPath>
          </defs>
          {[30, 70, 110, 150].map((y) => <line key={y} x1="0" x2="480" y1={y} y2={y} stroke="#27313c" strokeDasharray="2 6" />)}
          <motion.path d={`${INK} L330 170 L0 170Z`} fill="url(#haArea)" initial={init ?? { opacity: 0 }} animate={{ opacity: 1 }} transition={on(T.ink + T.inkDur * 0.6, 0.8)} />
          <motion.path d={INK} fill="none" stroke="#c9a86a" strokeWidth="3" strokeLinecap="round" initial={init ?? { pathLength: 0 }} animate={{ pathLength: 1 }} transition={on(T.ink, T.inkDur)} />
          <motion.g initial={init ?? { opacity: 0 }} animate={{ opacity: 1 }} transition={on(T.today, 0.3)}>
            <line x1="330" x2="330" y1="10" y2="170" stroke="#8d98a5" strokeOpacity=".4" />
            <text x="322" y="20" textAnchor="end" fill="#c9a86a" fontSize="10" letterSpacing="1">TODAY</text>
            <text x="338" y="20" fill="#8d98a5" fontSize="10" letterSpacing="1">ESTIMATE</text>
          </motion.g>
          <g clipPath="url(#haPencil)"><path d={PENCIL} fill="none" stroke="#b9c1c7" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" /></g>
          <motion.circle cx="330" cy="66" r="5" fill="#c9a86a" stroke="#121820" strokeWidth="3" initial={init ?? { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: T.today, type: 'spring', stiffness: 420, damping: 18 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        </svg>
        {/* The invoice lives inside the ledger as a row; the PAID stamp lands on it and cash rises in the same beat. */}
        <motion.div className="ha-inv" initial={init ?? { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={on(T.card, 0.6)}>
          <span className="ha-inv-id mono">INV-0042</span>
          <span className="ha-inv-who">Cedar House<small>due Oct 27</small></span>
          <b className="num">$4,250.00</b>
          <motion.span className="hi-stamp" initial={init ?? { opacity: 0, scale: 1.6, rotate: -14 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ delay: T.stamp, type: 'spring', stiffness: 460, damping: 22 }}>Paid</motion.span>
        </motion.div>
        <motion.p className="ha-inv-note" initial={init ?? { opacity: 0 }} animate={{ opacity: 1 }} transition={on(T.stamp + 0.15, 0.4)}>Payment recorded · cash on hand + $4,250.00</motion.p>
      </div>
    </div>
  );
}

const sources = [
  { label: 'Client payments', y: 70, w: 26 },
  { label: 'Retainers', y: 150, w: 14 },
  { label: 'Other income', y: 220, w: 6 },
];
const sinks = [
  { label: 'Payroll', y: 50, w: 18 },
  { label: 'Rent', y: 115, w: 8 },
  { label: 'Software', y: 170, w: 6 },
  { label: 'Reserve', y: 235, w: 14 },
];

export function CashFlowRiver() {
  const { ref, inView, offscreen } = useInView<HTMLDivElement>();
  return (
    <div className={`river ${inView ? 'play' : ''}`} ref={ref} data-offscreen={offscreen} aria-hidden="true">
      <svg viewBox="0 0 640 290" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="rvIn" x1="0" x2="1"><stop offset="0" stopColor="#c9a86a" stopOpacity=".15" /><stop offset="1" stopColor="#c9a86a" stopOpacity=".55" /></linearGradient>
          <linearGradient id="rvOut" x1="0" x2="1"><stop offset="0" stopColor="#c9a86a" stopOpacity=".55" /><stop offset="1" stopColor="#5a6a79" stopOpacity=".35" /></linearGradient>
        </defs>
        {sources.map((s, i) => {
          const d = `M120 ${s.y} C220 ${s.y} 230 145 320 145`;
          return (
            <g key={s.label}>
              <path d={d} stroke="url(#rvIn)" strokeWidth={s.w} fill="none" className="rv-band" />
              <path d={d} stroke="#f4e3bd" strokeWidth="1.6" fill="none" strokeDasharray="2 14" className="rv-flow" style={{ animationDelay: `${i * -0.7}s` }} />
              <text x="110" y={s.y + 4} textAnchor="end" className="rv-label">{s.label}</text>
            </g>
          );
        })}
        {sinks.map((s, i) => {
          const d = `M320 145 C410 145 420 ${s.y} 520 ${s.y}`;
          return (
            <g key={s.label}>
              <path d={d} stroke="url(#rvOut)" strokeWidth={s.w} fill="none" className="rv-band" />
              <path d={d} stroke="#f4e3bd" strokeWidth="1.6" fill="none" strokeDasharray="2 14" className="rv-flow" style={{ animationDelay: `${i * -0.5}s` }} />
              <text x="530" y={s.y + 4} className="rv-label">{s.label}</text>
            </g>
          );
        })}
        <g className="rv-node">
          <circle cx="320" cy="145" r="40" fill="#121820" stroke="#c9a86a" strokeOpacity=".6" />
          <circle cx="320" cy="145" r="40" fill="none" stroke="#c9a86a" className="rv-ring" />
          <text x="320" y="141" textAnchor="middle" className="rv-node-label">CASH</text>
          <text x="320" y="158" textAnchor="middle" className="rv-node-sub">in → out</text>
        </g>
      </svg>
    </div>
  );
}

export function InvoiceFlow() {
  const { ref, inView, offscreen } = useInView<HTMLDivElement>();
  const stages = ['Draft', 'Sent', 'Partially paid', 'Paid'];
  return (
    <div className={`inv-flow ${inView ? 'play' : ''}`} ref={ref} data-offscreen={offscreen} aria-hidden="true">
      <div className="if-track">
        <div className="if-progress" />
        {stages.map((s, i) => (
          <div key={s} className="if-stage" style={{ ['--i' as string]: i }}><span className="if-dot" /><span className="if-name">{s}</span></div>
        ))}
      </div>
      <div className="if-doc">
        <div className="if-doc-head"><span className="wordmark" style={{ fontSize: 13 }}>mor<span>gan</span></span><b>INV-0108</b></div>
        <div className="if-doc-lines">
          <div><span>Brand strategy</span><span className="num">$6,000.00</span></div>
          <div><span>Design sprint · 2 wks</span><span className="num">$5,400.00</span></div>
          <div><span>Tax 8.25%</span><span className="num">$940.50</span></div>
        </div>
        <div className="if-doc-total"><span>Balance due</span><b className="num if-balance" /></div>
        <span className="if-stamp">PAID</span>
      </div>
    </div>
  );
}

export function SpendingLens() {
  const { ref, inView, offscreen } = useInView<HTMLDivElement>();
  const bars = [
    { l: 'Payroll', v: 92 }, { l: 'Software', v: 64, hot: true }, { l: 'Rent', v: 48 }, { l: 'Travel', v: 30 }, { l: 'Supplies', v: 18 },
  ];
  return (
    <div className={`lens ${inView ? 'play' : ''}`} ref={ref} data-offscreen={offscreen} aria-hidden="true">
      {bars.map((b, i) => (
        <div key={b.l} className={`lens-row ${b.hot ? 'hot' : ''}`} style={{ ['--v' as string]: `${b.v}%`, ['--i' as string]: i }}>
          <span>{b.l}</span><div><i /></div>
        </div>
      ))}
      <div className="lens-note">
        <b>Software +38%</b>
        <span>vs prior 30 days · 2 vendors</span>
      </div>
      <div className="lens-glass" />
    </div>
  );
}

/* ---------------- Empty-state illustrations ---------------- */
export function EmptyArt({ kind }: { kind: 'ledger' | 'invoice' | 'chart' | 'insight' | 'people' | 'bill' }) {
  return (
    <svg className={`empty-art ea-${kind}`} width="132" height="104" viewBox="0 0 132 104" aria-hidden="true">
      <ellipse cx="66" cy="96" rx="44" ry="5" fill="#000" opacity=".35" />
      {kind === 'invoice' || kind === 'bill' ? (
        <g className="ea-float">
          <rect x="34" y="14" width="64" height="78" rx="6" fill="#19212b" stroke="#27313c" />
          <rect x="44" y="26" width="26" height="5" rx="2.5" fill="#c9a86a" />
          {[42, 52, 62].map((y) => <rect key={y} x="44" y={y} width="44" height="3.5" rx="1.75" fill="#27313c" />)}
          <rect x="62" y="76" width="26" height="6" rx="3" fill="#c9a86a" opacity=".7" />
          <circle className="ea-coin" cx="104" cy="30" r="9" fill="#121820" stroke="#c9a86a" strokeWidth="1.5" />
          <text x="104" y="34" textAnchor="middle" fontSize="11" fill="#c9a86a" fontWeight="700">{kind === 'bill' ? '−' : '$'}</text>
        </g>
      ) : kind === 'chart' || kind === 'insight' ? (
        <g className="ea-float">
          <rect x="18" y="16" width="96" height="70" rx="8" fill="#19212b" stroke="#27313c" />
          {[30, 46, 62].map((y) => <line key={y} x1="28" x2="104" y1={y} y2={y} stroke="#27313c" strokeDasharray="2 4" />)}
          <path className="ea-draw" pathLength={1} d="M28 72 C44 68 50 52 64 56 S88 34 104 30" fill="none" stroke="#c9a86a" strokeWidth="2.5" strokeLinecap="round" />
          {kind === 'insight' && <g className="ea-spark"><path d="m104 10 2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z" fill="#c9a86a" /></g>}
        </g>
      ) : kind === 'people' ? (
        <g className="ea-float">
          <circle cx="52" cy="40" r="14" fill="#19212b" stroke="#27313c" />
          <path d="M28 82c3-14 12-22 24-22s21 8 24 22" fill="#19212b" stroke="#27313c" />
          <circle cx="84" cy="44" r="11" fill="#19212b" stroke="#c9a86a" strokeOpacity=".6" />
          <path d="M66 82c2-11 9-17 18-17s16 6 18 17" fill="#19212b" stroke="#c9a86a" strokeOpacity=".6" />
        </g>
      ) : (
        <g className="ea-float">
          <rect x="22" y="18" width="88" height="68" rx="8" fill="#19212b" stroke="#27313c" />
          {[32, 46, 60, 74].map((y, i) => (
            <g key={y}><rect x="32" y={y - 3} width={i % 2 ? 36 : 46} height="5" rx="2.5" fill="#27313c" /><rect x="86" y={y - 3} width="14" height="5" rx="2.5" fill={i === 1 ? '#c9a86a' : '#27313c'} className={i === 1 ? 'ea-blink' : ''} /></g>
          ))}
        </g>
      )}
    </svg>
  );
}

export function EmptyState({ kind, title, children, actions }: { kind: Parameters<typeof EmptyArt>[0]['kind']; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="empty">
      <EmptyArt kind={kind} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

const tape = [
  ['Oct 21', 'Cedar House', 'Payment · INV-0108', '+12,340.50'],
  ['Oct 20', 'Gusto', 'Payroll', '−14,200.00'],
  ['Oct 18', 'Harbor Workspace', 'Rent', '−1,850.00'],
  ['Oct 16', 'Figma', 'Software', '−180.00'],
  ['Oct 15', 'Meridian Labs', 'Retainer', '+11,200.00'],
  ['Oct 12', 'Cloudline', 'Hosting', '−684.00'],
  ['Oct 10', 'Aster & Row', 'Project', '+7,400.00'],
  ['Oct 09', 'West & Pine', 'Supplies', '−412.50'],
];

/** A slowly moving tape of sample ledger entries. Decorative; pauses under reduced motion. */
export function LedgerTape({ vertical = false }: { vertical?: boolean }) {
  const rows = [...tape, ...tape];
  const { ref, offscreen } = useInView<HTMLDivElement>(0);
  return (
    <div className={`tape ${vertical ? 'tape-v' : 'tape-h'}`} ref={ref} data-offscreen={offscreen} aria-hidden="true">
      <div className="tape-track">
        {rows.map(([d, who, what, amt], i) => (
          <div className="tape-row" key={i}>
            <span className="mono tape-d">{d}</span>
            <span className="tape-who">{who}<small>{what}</small></span>
            <span className={`mono tape-amt ${amt.startsWith('+') ? 'pos' : ''}`}>{amt}</span>
          </div>
        ))}
      </div>
      <span className="tape-label mono">Sample entries</span>
    </div>
  );
}

/** Live "ledger cover" for signup: reflects what the person types, before anything is saved. */
export function LedgerCover({ name, business, currency, strength }: { name: string; business: string; currency: string; strength: number }) {
  const initial = (business || 'M').trim().charAt(0).toUpperCase() || 'M';
  return (
    <div className="cover" aria-hidden="true">
      <div className="cover-spine" />
      <div className="cover-face">
        <div className="cover-top"><span className="mono">LEDGER N°0001</span><span className="mono">{currency}</span></div>
        <div className="cover-mono">{initial}</div>
        <div className="cover-name">{business || 'Your business'}</div>
        <div className="cover-owner mono">Kept by {name || '—'}</div>
        <svg className="cover-line" viewBox="0 0 300 60" preserveAspectRatio="none">
          <path d="M0 52 C40 48 60 50 90 40 S150 42 180 30 S240 22 300 8" fill="none" stroke="#c9a86a" strokeWidth="2" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - Math.min(1, (name ? 0.25 : 0) + (business ? 0.35 : 0) + strength * 0.1) }} />
        </svg>
        <div className="cover-foot">
          <span className="mono">Opening balance</span><span className="mono">{currency} 0.00</span>
        </div>
        <div className="cover-lock"><span className="mono">Secured</span><i style={{ width: `${Math.min(100, strength * 25)}%` }} /></div>
      </div>
    </div>
  );
}
