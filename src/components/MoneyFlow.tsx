import { useEffect, useMemo, useRef, useState } from 'react';
import { m, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { formatMoney } from '../../shared/money.js';
import { SAMPLE_LAST_RECORDED_WEEK as TODAY_AFTER, SAMPLE_OPENING_CENTS as OPENING, SAMPLE_WEEKS as WEEKS } from '../lib/financialSample';

/*
  "Follow money in, and out." — a weekly cash statement that the visitor scrubs by scrolling.
  Scroll is time: weeks post one by one in gold ink (money in up, money out down, closing balance
  joined by a line); after TODAY the same statement continues in pencil (estimates).
  Every week is a button that opens the entries behind it. Phones and reduced motion get the full,
  unpinned statement. Sample figures, integer cents.
*/
const STEPS = [
  { title: 'Money in', body: 'Client payments and retainers rise from the opening balance as gold bars.' },
  { title: 'Money out', body: 'Payroll, rent and software draw it back down. Every bar is a recorded transaction.' },
  { title: 'Net cash flow', body: 'The line joins each week’s closing balance — income minus expenses, nothing assumed.' },
  { title: 'After today, pencil', body: 'Open invoices and unpaid bills continue the statement as dashed estimates. They never look like records.' },
];

const fmt = (c: number) => formatMoney(c, 'USD');
const short = (c: number) => formatMoney(c, 'USD', { compact: true });

/** Scroll progress (0–1) through the pinned section → weeks posted and narrative step. */
// Chart geometry (viewBox units). Text stays undistorted: the SVG scales uniformly.
const W = 600, H = 400, L = 52, R = 8, T = 30, B = 22;
// Scroll drives a continuous reveal edge across the chart; a week posts the moment the edge passes its close.
const fracAt = (p: number) => Math.min(1, Math.max(0, (p - 0.03) / 0.9));
const postedAt = (p: number) => Math.min(8, Math.max(1, Math.floor(fracAt(p) * 8 - 0.74) + 1));
const stepFor = (posted: number) => (posted <= 2 ? 0 : posted <= 4 ? 1 : posted === 5 ? 2 : 3);
const progressForWeek = (i: number) => 0.03 + 0.9 * Math.min(1, (i + 0.8) / 8);

function useWide() {
  const q = '(min-width: 1100px) and (min-height: 780px)'; // pin only where the whole statement fits one screen
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

export function MoneyFlow() {
  const reduced = !!useReducedMotion();
  const wide = useWide();
  const pinned = wide && !reduced;
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [posted, setPosted] = useState(pinned ? 1 : WEEKS.length);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => { setPosted(pinned ? postedAt(scrollYProgress.get()) : WEEKS.length); }, [pinned, scrollYProgress]);
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (!pinned) return;
    const n = postedAt(p);
    setPosted((cur) => { if (cur !== n) setPicked(null); return n; });
  });

  // Running balances, in cents.
  const rows = useMemo(() => {
    let bal = OPENING;
    return WEEKS.map((w) => {
      const inflow = w.entries.filter((e) => e.cents > 0).reduce((s, e) => s + e.cents, 0);
      const outflow = -w.entries.filter((e) => e.cents < 0).reduce((s, e) => s + e.cents, 0);
      const open = bal; bal = open + inflow - outflow;
      return { ...w, inflow, outflow, open, peak: open + inflow, close: bal };
    });
  }, []);

  const step = pinned ? stepFor(posted) : null;
  const revealW = useTransform(scrollYProgress, (p) => (pinned ? L + (W - L - R) * fracAt(p) + 6 : W));
  const active = picked ?? (pinned ? posted - 1 : TODAY_AFTER);
  const row = rows[active];

  const lo = Math.min(OPENING, ...rows.map((r) => r.close)) - 400_000;
  const hi = Math.max(...rows.map((r) => r.peak)) + 300_000;
  const y = (c: number) => T + (H - T - B) * (1 - (c - lo) / (hi - lo));
  const col = (W - L - R) / rows.length;
  const cx = (i: number) => L + col * i;
  const endX = (i: number) => cx(i) + col * 0.74;
  const ticks = [5_000_000, 6_000_000, 7_000_000, 8_000_000].filter((t) => t > lo && t < hi && Math.abs(t - OPENING) > 300_000);
  const todayX = cx(TODAY_AFTER + 1) - col * 0.06;
  const inkPath = rows.slice(0, TODAY_AFTER + 1).map((r, i) => `${i ? 'L' : 'M'}${endX(i)},${y(r.close)}`).join('');
  const pencilPath = rows.slice(TODAY_AFTER).map((r, i) => `${i ? 'L' : 'M'}${endX(i + TODAY_AFTER)},${y(r.close)}`).join('');

  // Tell the page where TODAY falls in its scroll range, so the reading-progress line turns to pencil there.
  useEffect(() => {
    const place = () => {
      const el = ref.current; if (!el) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      const top = el.getBoundingClientRect().top + scrollY;
      const at = pinned ? top + (el.offsetHeight - innerHeight) * 0.6 : top + el.offsetHeight / 2 - innerHeight / 2;
      document.documentElement.style.setProperty('--today', `${Math.min(100, Math.max(0, (at / max) * 100)).toFixed(2)}%`);
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(document.body);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--today'); };
  }, [pinned]);

  function pick(i: number) {
    if (!pinned || !ref.current) { setPicked(i); return; }
    // In the pinned statement a week lives at a scroll position: go there, so scroll and selection agree.
    const top = ref.current.getBoundingClientRect().top + window.scrollY;
    const span = ref.current.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + span * progressForWeek(i), behavior: reduced ? 'auto' : 'smooth' });
    setPicked(i);
  }

  return (
    <section ref={ref} id="money-flow" className={`mf ${pinned ? 'pinned' : ''}`} aria-labelledby="mf-title">
      <div className="mf-stage">
        <div className="mf-copy">
          <span className="folio"><span>N°04</span><b>Cash in motion</b></span>
          <h2 id="mf-title">Follow money in, <span className="serif">and out.</span></h2>
          <p className="mf-lead">Eight weeks of a sample business’s cash, posted the way Morgan posts yours: from records, week by week — until today, where the ink stops.</p>
          <ol className="mf-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className={step === null ? '' : i === step ? 'on' : i < step ? 'done' : ''} aria-current={step === i ? 'step' : undefined}>
                <span className="mf-step-mark" aria-hidden="true">{i === 3 ? <svg width="22" height="2"><line x1="0" y1="1" x2="22" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" /></svg> : <svg width="22" height="2"><line x1="0" y1="1" x2="22" y2="1" stroke="currentColor" strokeWidth="2" /></svg>}</span>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className={`mf-board step-${step ?? 'all'}`}>
          <div className="mf-head">
            <div className={`mf-figure ${row.est ? 'est' : ''}`} aria-live="polite">
              <span className="mf-figure-label">{row.est ? 'Projected balance · estimate' : 'Recorded balance'} · week of {row.start}</span>
              <span className="mf-figure-value num">{fmt(row.close)}</span>
            </div>
            <div className="mf-legend" aria-hidden="true">
              <span><i className="lg-in" />Money in</span><span><i className="lg-out" />Money out</span>
              <span><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#c9a86a" strokeWidth="2.5" /></svg>Recorded</span>
              <span><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#b9c1c7" strokeWidth="2" strokeDasharray="4 4" /></svg>Estimate</span>
            </div>
          </div>

          <svg className="mf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly cash statement, sample business. Opening ${fmt(OPENING)}. ${rows.map((r) => `Week of ${r.start}${r.est ? ' (estimate)' : ''}: in ${fmt(r.inflow)}, out ${fmt(r.outflow)}, closing ${fmt(r.close)}`).join('. ')}.`}>
            <defs>
              <pattern id="mfPencil" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#b9c1c7" strokeOpacity=".35" strokeWidth="1.5" /></pattern>
              <clipPath id="mfReveal"><m.rect x="0" y="0" height={H} style={{ width: revealW }} /></clipPath>
            </defs>
            {ticks.map((t) => (
              <g key={t}><line className="mf-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="mf-axis" x={L - 10} y={y(t) + 4} textAnchor="end">{short(t)}</text></g>
            ))}
            <line className="mf-opening" x1={L} x2={W - R} y1={y(OPENING)} y2={y(OPENING)} />
            <text className="mf-axis mf-axis-open" x={L - 10} y={y(OPENING) + 4} textAnchor="end">{short(OPENING)}<title>{`Opening balance ${fmt(OPENING)}`}</title></text>

            <g className="mf-today">
              <line x1={todayX} x2={todayX} y1={T - 12} y2={H - B} />
              <text x={todayX - 8} y={T - 2} textAnchor="end" className="ink">TODAY</text>
              <text x={todayX + 8} y={T - 2} className="pencil">ESTIMATE</text>
            </g>

            {rows.map((r, i) => {
              const isPosted = i < posted;
              const x = cx(i) + col * 0.16, bw = col * 0.24;
              return (
                <g key={r.start} className={`mf-week ${isPosted ? 'posted' : 'ghost'} ${r.est ? 'est' : 'rec'} ${i === active ? 'active' : ''}`}>
                  <rect className="mf-hit" x={cx(i) + 2} y={T} width={col - 4} height={H - T - B} rx="3" />
                  <rect className="mf-in" x={x} y={y(r.peak)} width={bw} height={y(r.open) - y(r.peak)} rx="2" />
                  <line className="mf-step" x1={x + bw} x2={x + bw + col * 0.06} y1={y(r.peak)} y2={y(r.peak)} />
                  <rect className="mf-out" x={x + bw + col * 0.06} y={y(r.peak)} width={bw} height={y(r.close) - y(r.peak)} rx="2" />
                </g>
              );
            })}

            <path className="mf-line ghost" d={inkPath + pencilPath.replace(/^M/, 'L')} />
            <g clipPath="url(#mfReveal)">
              <path className="mf-line ink" d={inkPath} />
              <path className="mf-line pencil" d={pencilPath} />
              {rows.map((r, i) => <circle key={r.start} className={`mf-dot ${r.est ? 'est' : ''} ${i === active ? 'active' : ''}`} cx={endX(i)} cy={y(r.close)} r={i === active ? 5.5 : 3.5} />)}
            </g>
          </svg>

          <div className="mf-weeks" role="group" aria-label="Weeks — open one to see its entries">
            {rows.map((r, i) => (
              <button key={r.start} type="button" className={`${i === active ? 'on' : ''} ${r.est ? 'est' : ''} ${i < posted ? '' : 'unposted'}`} aria-pressed={i === active} onClick={() => pick(i)}>
                <span className="mono wk-m">{r.start.split(' ')[0]}</span><span className="mono wk-d">{r.start.split(' ')[1]}</span>
                {i === TODAY_AFTER + 1 && <span className="sr-only">(after today: estimates)</span>}
              </button>
            ))}
          </div>

          <div className="mf-entries" aria-live="polite">
            <div className="mf-entries-head">
              <b>Week of {row.start}</b>
              <span>{row.est ? 'Expected from open invoices and unpaid bills' : 'Recorded transactions'}</span>
            </div>
            <ul>
              <li className="open"><span className="who">Opening</span><span className="amt num">{fmt(row.open)}</span></li>
              {row.entries.map((e) => (
                <li key={e.who + e.what} className={row.est ? 'est' : ''}>
                  <span className="who">{e.who}<small>{e.what}</small></span>
                  <span className={`amt num ${e.cents > 0 ? 'pos' : ''}`}>{e.cents > 0 ? '+' : '−'}{fmt(Math.abs(e.cents))}</span>
                </li>
              ))}
              <li className={`netweek ${row.est ? 'est' : ''}`}><span className="who">Net this week</span><span className="amt num">{row.close - row.open >= 0 ? '+' : '−'}{fmt(Math.abs(row.close - row.open))}</span></li>
              <li className="net"><span className="who">Closing</span><span className="amt num">{fmt(row.close)}</span></li>
            </ul>
          </div>
          <p className="mf-note mono">Sample business · illustrative figures</p>
        </div>
      </div>
    </section>
  );
}
