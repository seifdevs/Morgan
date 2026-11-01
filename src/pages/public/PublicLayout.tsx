import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, m, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { Icon, Marker, Wordmark } from '../../components/ui';
import { useAuth } from '../../lib/auth';

const links = [
  { to: '/features', label: 'Product' },
  { to: '/agency-financial-management', label: 'Agencies' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/resources', label: 'Resources' },
  { to: '/about', label: 'About' },
];
const EASE = [0.16, 1, 0.3, 1] as const;

/** The masthead's bottom rule doubles as reading position: ink up to TODAY (--today, set on home), pencil after. */
function ReadingProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 });
  // clip-path (not scaleX) keeps the pencil dashes evenly spaced.
  const clip = useTransform(reduced ? scrollYProgress : smooth, (p) => `inset(0 ${(100 - p * 100).toFixed(2)}% 0 0)`);
  return <m.span className="mast-progress" aria-hidden="true" style={{ clipPath: clip }} />;
}

export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const loc = useLocation();
  const home = loc.pathname === '/';
  const active = links.find((l) => loc.pathname.startsWith(l.to))?.to ?? null;
  const marked = hover ?? active;

  useEffect(() => { setOpen(false); setHover(null); }, [loc.pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className={`mast ${scrolled || open ? 'solid' : ''} ${home ? 'on-home' : ''}`}>
        <div className="mast-inner">
          <nav className="mast-links" aria-label="Main" onMouseLeave={() => setHover(null)}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} onMouseEnter={() => setHover(l.to)} onFocus={() => setHover(l.to)} onBlur={() => setHover(null)}>
                {l.label}{marked === l.to && <Marker id="mast-ul" className="mast-ul" />}
              </NavLink>
            ))}
          </nav>
          <div className="mast-mark"><Wordmark /></div>
          <div className="mast-actions">
            {user ? (
              <Link className="btn primary sm" to="/app">Open workspace <Icon name="upRight" size={14} className="arrow" /></Link>
            ) : (
              <>
                <Link className="mast-login" to="/login">Log in</Link>
                <Link className="btn primary sm" to="/signup">Get started <Icon name="upRight" size={14} className="arrow" /></Link>
              </>
            )}
            <button className={`mast-toggle ${open ? 'x' : ''}`} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mast-sheet" onClick={() => setOpen(!open)}>
              <i /><i />
            </button>
          </div>
        </div>
        <ReadingProgress />
      </header>

      <AnimatePresence>
        {open && (
          <m.nav id="mast-sheet" className="mast-sheet" aria-label="Menu"
            initial={{ clipPath: 'inset(0 0 100% 0)' }} animate={{ clipPath: 'inset(0 0 0% 0)' }} exit={{ clipPath: 'inset(0 0 100% 0)', transition: { duration: 0.26, ease: EASE } }}
            transition={{ duration: 0.45, ease: EASE }}>
            <div className="mast-sheet-links">
              {links.map((l, i) => (
                <m.div key={l.to} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.045, duration: 0.5, ease: EASE }}>
                  <NavLink to={l.to}>{l.label}<Icon name="arrowRight" size={20} /></NavLink>
                </m.div>
              ))}
            </div>
            <m.div className="mast-sheet-foot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.4 }}>
              {user ? <Link className="btn primary lg" to="/app">Open workspace</Link> : <><Link className="btn outline lg" to="/login">Log in</Link><Link className="btn primary lg" to="/signup">Get started</Link></>}
            </m.div>
          </m.nav>
        )}
      </AnimatePresence>

      <main id="main" className={home ? 'pub-main home-main' : 'pub-main'}><div className="route" key={loc.pathname}><Outlet /></div></main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="pub-footer">
      <div className="pf-inner">
        <div className="pf-close">
          <Wordmark />
          <p className="pf-line">Clarity without shortcuts, <span className="serif">confidence without overstatement.</span></p>
        </div>
        <nav className="pf-cols" aria-label="Footer">
          <div><h4>Product</h4><Link to="/features">Overview</Link><Link to="/agency-financial-management">For agencies</Link><Link to="/agency-cash-flow">Agency cash flow</Link><Link to="/agency-profitability">Agency profitability</Link><Link to="/pricing">Pricing</Link><Link to="/signup">Create account</Link><Link to="/login">Log in</Link></div>
          <div><h4>Company</h4><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
          <div><h4>Resources</h4><Link to="/resources">Guides</Link><Link to="/faq">FAQ</Link></div>
        </nav>
      </div>
      <div className="pf-base">
        <small>© {new Date().getFullYear()} Morgan Financial</small>
        <small>Morgan doesn’t connect to banks or move money. Every figure comes from records you enter or import — and works alongside your accountant, not instead of them.</small>
      </div>
    </footer>
  );
}
