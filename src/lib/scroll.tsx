import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/*
  One owner for scroll position across the SPA:
  - in-page anchors scroll smoothly (instantly under reduced motion), land below the sticky header
    (via CSS scroll-margin / scroll-padding), and become history entries so Back returns to them;
  - a new page starts at the top, or at its #hash once lazy content has rendered;
  - Back/Forward restore the position the visitor left.
  Replaces `scroll-behavior: smooth` on <html>, which also animated every route change.
*/
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const key = (k: string) => `morgan:scroll:${k}`;

/** Retry for up to ~1.5s: lazy routes and data render after navigation. */
function whenReady(test: () => boolean, run: () => void) {
  let tries = 0;
  const tick = () => { if (test() || tries++ > 90) run(); else requestAnimationFrame(tick); };
  tick();
}

export function scrollToHash(hash: string, smooth: boolean) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return;
  whenReady(() => !!document.getElementById(id), () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: smooth && !reduced() ? 'smooth' : 'auto', block: 'start' });
    // Move focus for keyboard and screen-reader users without a second jump.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });
}

export function ScrollManager() {
  const loc = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const prevPath = useRef(loc.pathname);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  // Remember where the visitor is on this history entry. The position is recorded synchronously while
  // scrolling and that recorded value is flushed on navigation: by the time this effect's cleanup runs,
  // the next page's layout effect has already moved the window, so reading scrollY there would be wrong.
  const entry = `${loc.key}:${loc.pathname}`; // fresh loads all share the key "default"
  const current = useRef(entry);
  useEffect(() => {
    let last = Math.round(window.scrollY);
    const save = () => { try { sessionStorage.setItem(key(entry), String(last)); } catch { /* storage unavailable */ } };
    let t = 0;
    // Once the history entry has changed, scrolls belong to the next page (e.g. its scroll-to-top).
    const onScroll = () => { if (current.current !== entry) return; last = Math.round(window.scrollY); clearTimeout(t); t = window.setTimeout(save, 120); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(t); save(); window.removeEventListener('scroll', onScroll); };
  }, [entry]);

  useLayoutEffect(() => {
    current.current = entry;
    const samePage = prevPath.current === loc.pathname;
    prevPath.current = loc.pathname;
    if (navType === 'POP') {
      let y: string | null = null;
      try { y = sessionStorage.getItem(key(entry)); } catch { /* ignore */ }
      if (y !== null) { const target = +y; whenReady(() => document.documentElement.scrollHeight - innerHeight >= target, () => window.scrollTo(0, target)); return; }
    }
    if (loc.hash) { scrollToHash(loc.hash, samePage); return; }
    if (!samePage) window.scrollTo(0, 0);
  }, [loc.key]); // keyed on the history entry only: hash/pathname are read from that entry

  // Same-page anchor links go through the router so they join history.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.('a[href*="#"]') as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      e.preventDefault();
      if (url.hash === location.hash) scrollToHash(url.hash, true);
      else navigate({ pathname: url.pathname, search: url.search, hash: url.hash });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);

  return null;
}
