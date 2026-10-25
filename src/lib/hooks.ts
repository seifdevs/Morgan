import { useCallback, useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { api } from './api';
import { useAuth } from './auth';
import { formatMoney } from '../../shared/money.js';

/** Fetch JSON from the API; re-runs when `path` changes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => ctrl.abort();
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Currency formatter bound to the signed-in business's currency. */
export function useMoney() {
  const { business } = useAuth();
  const cur = business?.currency || 'USD';
  return useCallback((cents: number, opts?: { compact?: boolean; sign?: boolean }) => formatMoney(cents, cur, opts), [cur]);
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Shows the value immediately; when it later changes (e.g. a new period), springs from the old figure to the new one.
 *  Product screens don't replay a count-up on every visit. */
export function useCountUp(target: number) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    if (reduced || shown.current === target) { shown.current = target; setValue(target); return; }
    const controls = animate(shown.current, target, {
      type: 'spring', stiffness: 120, damping: 24, restDelta: 0.5,
      onUpdate: (v) => { shown.current = v; setValue(Math.round(v)); },
      onComplete: () => { shown.current = target; setValue(target); },
    });
    return () => controls.stop();
  }, [target, reduced]);
  return value;
}

/** inView: latches true once seen (starts an illustration). offscreen: live flag used to pause loops while out of view. */
export function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setInView(true); return; }
    if (el.getBoundingClientRect().top < window.innerHeight) setInView(true);
    const io = new IntersectionObserver(([e]) => {
      setOffscreen(!e.isIntersecting);
      if (e.isIntersecting && e.intersectionRatio >= threshold) setInView(true);
    }, { threshold: [0, threshold] });
    io.observe(el);
    // Safety net: never leave an illustration in its pre-animation state if the observer doesn't fire.
    const t = setTimeout(() => setInView(true), 5000);
    return () => { io.disconnect(); clearTimeout(t); };
  }, [threshold]);
  return { ref, inView, offscreen };
}

export function useDocumentTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · Morgan` : 'Morgan — Financial clarity for business'; }, [title]);
}
