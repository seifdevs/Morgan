import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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

const PUBLIC_ORIGIN = 'https://morganhq.site';
type SeoOptions = { indexable?: boolean; canonicalPath?: string; schema?: Record<string, unknown> | Record<string, unknown>[] };

function setMeta(selector: string, attr: 'name' | 'property', key: string, value: string) {
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!value) { node?.remove(); return; }
  if (!node) { node = document.createElement('meta'); node.setAttribute(attr, key); document.head.append(node); }
  node.content = value;
}

/** Route-aware metadata for this client-routed site. Canonicals use the production origin,
 * so Vercel preview URLs do not become competing indexable copies. */
export function useDocumentTitle(title: string, description = '', options: SeoOptions = {}) {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname.replace(/\/{2,}/g, '/');
    const privateRoute = /^\/(?:app(?:\/|$)|admin(?:\/|$)|product(?:\/|$)|login$|signup$|logout$|forgot-password$|reset-password$|verify-email$)/.test(path);
    const indexable = options.indexable ?? !privateRoute;
    const pageTitle = title ? `${title} | Morgan` : 'Morgan | Financial management for agencies';
    const pageDescription = description || 'Morgan helps marketing and digital agencies organize invoices, spending, receivables and bills, then understand cash flow with records in view.';
    const canonicalPath = (options.canonicalPath || path).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    document.title = pageTitle;
    setMeta('meta[name="description"]', 'name', 'description', pageDescription);
    setMeta('meta[name="robots"]', 'name', 'robots', indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (indexable) {
      if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
      canonical.href = `${PUBLIC_ORIGIN}${canonicalPath}`;
      setMeta('meta[property="og:title"]', 'property', 'og:title', pageTitle);
      setMeta('meta[property="og:description"]', 'property', 'og:description', pageDescription);
      setMeta('meta[property="og:type"]', 'property', 'og:type', 'website');
      setMeta('meta[property="og:url"]', 'property', 'og:url', `${PUBLIC_ORIGIN}${canonicalPath}`);
      setMeta('meta[property="og:site_name"]', 'property', 'og:site_name', 'Morgan');
      setMeta('meta[property="og:image"]', 'property', 'og:image', `${PUBLIC_ORIGIN}/og-image.png`);
      setMeta('meta[property="og:image:width"]', 'property', 'og:image:width', '1200');
      setMeta('meta[property="og:image:height"]', 'property', 'og:image:height', '630');
      setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
      setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', pageTitle);
      setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', pageDescription);
      setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', `${PUBLIC_ORIGIN}/og-image.png`);
    } else {
      canonical?.remove();
      for (const selector of ['meta[property^="og:"]', 'meta[name^="twitter:"]']) document.head.querySelectorAll(selector).forEach((el) => el.remove());
    }

    document.head.querySelector('#morgan-page-schema')?.remove();
    if (indexable && options.schema) {
      const schema = Array.isArray(options.schema) ? { '@context': 'https://schema.org', '@graph': options.schema } : { '@context': 'https://schema.org', ...options.schema };
      const script = document.createElement('script');
      script.id = 'morgan-page-schema'; script.type = 'application/ld+json'; script.textContent = JSON.stringify(schema); document.head.append(script);
    }
  }, [title, description, location.pathname, options.indexable, options.canonicalPath, options.schema]);
}
