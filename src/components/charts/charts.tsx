import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** "Nice" axis ticks covering [min, max]. */
function ticks(min: number, max: number, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}

export type Series = { key: string; label: string; values: (number | null)[]; color: string; dashed?: boolean; area?: boolean };

/** Multi-series line chart with hover readout. Values in cents. */
export function LineChart({ labels, series, format, height = 240, markIndex, markLabel, ariaLabel }: {
  labels: string[]; series: Series[]; format: (v: number) => string; height?: number; markIndex?: number; markLabel?: string; ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const pad = { l: 64, r: 16, t: 16, b: 30 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const t = ticks(Math.min(0, ...all), Math.max(10000, ...all)); // at least $100 of range so empty charts don't repeat $0
  const lo = t[0], hi = t.at(-1)!;
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const path = (vals: (number | null)[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const step = Math.max(1, Math.ceil(labels.length / Math.floor(iw / 64)));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - pad.l) / iw) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity=".28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'grid zero' : 'grid'} />
            <text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="axis">{format(v)}</text>
          </g>
        ))}
        {labels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="axis">{l}</text>)}
        {markIndex !== undefined && (
          <g className="mark">
            <line x1={x(markIndex)} x2={x(markIndex)} y1={pad.t} y2={pad.t + ih} />
            {markLabel && <text x={x(markIndex) + 6} y={pad.t + 10} className="axis">{markLabel}</text>}
          </g>
        )}
        {series.map((s) => {
          const d = path(s.values);
          const first = s.values.findIndex((v) => v !== null);
          const last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
          return (
            <g key={s.key}>
              {s.area && d && <path d={`${d}L${x(last)},${y(Math.max(lo, 0))}L${x(first)},${y(Math.max(lo, 0))}Z`} fill={`url(#${gid}-${s.key})`} className="area" />}
              {first === last && first >= 0 && <circle cx={x(first)} cy={y(s.values[first] as number)} r="5.5" fill={s.color} stroke="#121820" strokeWidth="3" />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 2 : 2.6} strokeDasharray={s.dashed ? '5 6' : undefined} strokeLinecap="round" strokeLinejoin="round" className={s.dashed ? 'line dashed' : 'line draw'} pathLength={s.dashed ? undefined : 1} />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
            {series.map((s) => s.values[hover] !== null && <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r="4.5" fill={s.color} stroke="#121820" strokeWidth="2.5" />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(width - 180, Math.max(0, x(hover) - 90)) }}>
          <div className="tt-title">{labels[hover]}</div>
          {series.map((s) => s.values[hover] !== null && (
            <div key={s.key} className="tt-row"><i style={{ background: s.color }} />{s.label}<b className="num">{format(s.values[hover] as number)}</b></div>
          ))}
        </div>
      )}
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => <span key={i.label}><i className={i.dashed ? 'dashed' : ''} style={{ ['--c' as string]: i.color }} />{i.label}</span>)}
    </div>
  );
}

/** Monthly income (up) vs expenses (down) with net markers. */
export function FlowBars({ rows, format, height = 260, onSelect }: {
  rows: { label: string; income: number; expenses: number; net: number }[]; format: (v: number) => string; height?: number; onSelect?: (i: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const max = Math.max(10000, ...rows.map((r) => Math.max(r.income, r.expenses)));
  const t = ticks(-max, max, 4);
  const lo = t[0], hi = t.at(-1)!;
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const band = iw / rows.length;
  const bw = Math.min(26, band * 0.42);
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Monthly income and expenses">
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'grid zero' : 'grid'} />
            <text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="axis">{format(Math.abs(v))}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={i} className={`bar-group ${hover === i ? 'hot' : ''}`} style={{ ['--i' as string]: i }}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => onSelect?.(i)}>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
              <rect className="bar up" x={cx - bw / 2} y={y(r.income)} width={bw} height={Math.max(0, y(0) - y(r.income))} rx="3" />
              <rect className="bar down" x={cx - bw / 2} y={y(0)} width={bw} height={Math.max(0, y(-r.expenses) - y(0))} rx="3" />
              <circle cx={cx} cy={y(r.net)} r="3.5" className={r.net >= 0 ? 'net pos' : 'net neg'} />
              {(rows.length <= 8 || i % 2 === rows.length % 2) && <text x={cx} y={height - 8} textAnchor="middle" className="axis">{r.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(width - 190, Math.max(0, pad.l + band * hover + band / 2 - 95)) }}>
          <div className="tt-title">{rows[hover].label}</div>
          <div className="tt-row"><i style={{ background: 'var(--gold)' }} />Income<b className="num">{format(rows[hover].income)}</b></div>
          <div className="tt-row"><i style={{ background: '#5a6a79' }} />Expenses<b className="num">{format(rows[hover].expenses)}</b></div>
          <div className="tt-row"><i style={{ background: 'var(--text)' }} />Net<b className={`num ${rows[hover].net >= 0 ? 'pos' : 'neg'}`}>{format(rows[hover].net)}</b></div>
        </div>
      )}
      <Legend items={[{ label: 'Income', color: 'var(--gold)' }, { label: 'Expenses', color: '#5a6a79' }, { label: 'Net', color: 'var(--text)' }]} />
    </div>
  );
}

/** Ranked horizontal bars with prior-period tick. */
export function BreakdownList({ rows, format, total, onSelect, selected, limit = 8 }: {
  rows: { name: string; amount: number; priorAmount: number; count: number }[]; format: (v: number) => string; total: number;
  onSelect?: (name: string) => void; selected?: string; limit?: number;
}) {
  const shown = rows.filter((r) => r.amount > 0).slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => Math.max(r.amount, r.priorAmount)));
  return (
    <ul className="breakdown" role="list">
      {shown.map((r, i) => {
        const change = r.priorAmount ? (r.amount - r.priorAmount) / r.priorAmount : null;
        return (
          <li key={r.name} style={{ ['--i' as string]: i }}>
            <button className={`bd-row ${selected === r.name ? 'active' : ''}`} onClick={() => onSelect?.(r.name)} aria-pressed={selected === r.name}>
              <span className="bd-name">{r.name}<small>{r.count} txn{r.count === 1 ? '' : 's'} · {total ? ((r.amount / total) * 100).toFixed(1) : 0}%</small></span>
              <span className="bd-amt num">{format(r.amount)}
                <small className={change === null ? 'muted' : change > 0.005 ? 'neg' : change < -0.005 ? 'pos' : 'muted'}>
                  {change === null ? 'new' : `${change > 0 ? '+' : ''}${(change * 100).toFixed(0)}% vs prior`}
                </small>
              </span>
              <span className="bd-track">
                <span className="bd-fill" style={{ width: `${(r.amount / max) * 100}%` }} />
                {r.priorAmount > 0 && <span className="bd-prior" style={{ left: `${(r.priorAmount / max) * 100}%` }} title={`Prior: ${format(r.priorAmount)}`} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function StackBar({ parts, format }: { parts: { label: string; amount: number; color: string; count?: number }[]; format: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.amount, 0);
  return (
    <div className="stackbar">
      <div className="sb-track" role="img" aria-label={parts.map((p) => `${p.label}: ${format(p.amount)}`).join(', ')}>
        {total > 0 ? parts.filter((p) => p.amount > 0).map((p) => (
          <span key={p.label} style={{ width: `${(p.amount / total) * 100}%`, background: p.color }} title={`${p.label}: ${format(p.amount)}`} />
        )) : <span style={{ width: '100%', background: 'var(--line)' }} />}
      </div>
      <div className="sb-legend">
        {parts.map((p) => (
          <div key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b className="num">{format(p.amount)}</b>{p.count !== undefined && <small>{p.count}</small>}</div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values, color = 'var(--gold)', height = 36 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 120, min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}

export function ChartFrame({ title, aside, children, note }: { title: ReactNode; aside?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="panel chart-panel">
      <div className="panel-head"><h2>{title}</h2>{aside}</div>
      <div className="panel-body">{children}{note && <p className="chart-note">{note}</p>}</div>
    </section>
  );
}
