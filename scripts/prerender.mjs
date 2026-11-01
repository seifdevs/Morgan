import { createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter, Routes, Route } from 'react-router-dom';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const dist = resolve(root, 'dist');
const origin = 'https://morganhq.site';
const entries = [
  { path: '/', output: 'index.html', title: 'Financial management software for agencies', description: 'Financial management software for US marketing and digital agencies. Organize cash, invoices, expenses, receivables and payables, then review agency cash flow and profitability with records in view.', schema: true },
  { path: '/features', output: 'seo-pages/features.html', title: 'Financial management features for agencies', description: 'Explore Morgan workflows for agency spending analysis, invoices, bills, receivables, reports and cash-flow estimates.' },
  { path: '/pricing', output: 'seo-pages/pricing.html', title: 'Pricing', description: 'Morgan is free to use today. Review planned Pro and Business monthly prices and what is currently available.' },
  { path: '/about', output: 'seo-pages/about.html', title: 'About Morgan', description: 'Learn why founder Seif is building Morgan as a practical financial management and insight layer for small and growing businesses.' },
  { path: '/resources', output: 'seo-pages/resources.html', title: 'Financial management resources for agencies', description: 'Practical guides to agency cash position, receivables aging, cash-flow assumptions, document review and monthly financial reviews.' },
  { path: '/faq', output: 'seo-pages/faq.html', title: 'Morgan FAQ', description: 'Answers about Morgan’s financial workflows, data sources, invoicing, reports, account security and proposed pricing.' },
  { path: '/contact', output: 'seo-pages/contact.html', title: 'Contact Morgan', description: 'Contact information for Morgan product questions and feedback.', indexable: false },
  { path: '/not-found', output: '404.html', title: 'Page not found', description: 'This Morgan page could not be found.', indexable: false },
  { path: '/agency-financial-management', output: 'seo-pages/agency-financial-management.html', title: 'Financial management for agencies', description: 'A practical financial management workspace for marketing and digital agencies. Organize invoices, expenses, receivables, bills and cash-flow estimates together.' },
  { path: '/agency-cash-flow', output: 'seo-pages/agency-cash-flow.html', title: 'Cash-flow management for agencies', description: 'Explore agency cash flow with open invoices, unpaid bills and an inspectable 13-week estimate. Learn what the forecast includes and what it leaves out.' },
  { path: '/agency-profitability', output: 'seo-pages/agency-profitability.html', title: 'Profitability tracking for agencies', description: 'Review agency income and categorized expenses over time with Morgan. Understand the current limits of business-level reporting and how to prepare records for a useful review.' },
];
const guides = [
  ['cash-position', 'Read your cash position with context', 'A cash balance is a point-in-time number. It becomes more useful when you can also see what is expected to arrive and what is due to leave.'],
  ['receivables-aging', 'Make an invoice aging view easier to use', 'An aging view groups unpaid invoices by how far past due they are. It is a review tool, not a promise of collection.'],
  ['forecast-assumptions', 'Understand the assumptions behind a cash estimate', 'A forecast is an estimate built from records and assumptions. It can help you explore a scenario, but it cannot account for activity that has not been recorded or anticipated.'],
  ['document-review', 'A practical checklist for financial documents', 'Details copied from invoices, bills, and receipts should be checked against the source before they are treated as confirmed business records.'],
  ['business-planning', 'Build a business plan from clear assumptions', 'A useful operating plan connects expected revenue, recurring costs, timing, and decisions to assumptions you can revisit.'],
  ['monthly-review', 'A practical monthly financial review', 'A regular review helps a business understand what changed and which records need attention.'],
];
for (const [slug, title, description] of guides) entries.push({ path: `/resources/${slug}`, output: `seo-pages/resources-${slug}.html`, title, description });

function publicTree({ AuthProvider, PublicLayout, Home, Features, Pricing, About, Resources, ResourceDetail, Faq, Contact, NotFound, AgencyPage, ToastProvider, RenderBoundary, motionFeatures, location }) {
  const page = (component, props = {}) => h(component, props);
  return h(StrictMode, null,
      h((awaitableLazyMotion), { features: motionFeatures, strict: true },
        h((awaitableMotionConfig), { reducedMotion: 'user' },
          h(StaticRouter, { location },
            h(AuthProvider, null,
              h(ToastProvider, null,
                h(RenderBoundary, null,
                  h(Routes, null,
                    h(Route, { element: page(PublicLayout) },
                      h(Route, { index: true, element: page(Home) }),
                      h(Route, { path: 'features', element: page(Features) }),
                      h(Route, { path: 'product/*', element: page(Features) }),
                      h(Route, { path: 'agency-financial-management', element: page(AgencyPage, { topic: 'management' }) }),
                      h(Route, { path: 'agency-cash-flow', element: page(AgencyPage, { topic: 'cashflow' }) }),
                      h(Route, { path: 'agency-profitability', element: page(AgencyPage, { topic: 'profitability' }) }),
                      h(Route, { path: 'pricing', element: page(Pricing) }),
                      h(Route, { path: 'about', element: page(About) }),
                      h(Route, { path: 'resources', element: page(Resources) }),
                      h(Route, { path: 'resources/:slug', element: page(ResourceDetail) }),
                      h(Route, { path: 'faq', element: page(Faq) }),
                      h(Route, { path: 'contact', element: page(Contact) }),
                      h(Route, { path: '*', element: page(NotFound) }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
  );
}

// Imported lazily in the prerender process so Vite can resolve the motion package
// against the project's exact browser bundle.
let awaitableLazyMotion; let awaitableMotionConfig;
const vite = await createServer({ configFile: false, root, appType: 'custom', plugins: [react()], server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const [motion, auth, layout, home, pages, agency, ui, boundary, featureModule] = await Promise.all([
    import('motion/react'),
    vite.ssrLoadModule('/src/lib/auth.tsx'),
    vite.ssrLoadModule('/src/pages/public/PublicLayout.tsx'),
    vite.ssrLoadModule('/src/pages/public/Home.tsx'),
    vite.ssrLoadModule('/src/pages/public/Pages.tsx'),
    vite.ssrLoadModule('/src/pages/public/AgencyPages.tsx'),
    vite.ssrLoadModule('/src/components/ui.tsx'),
    vite.ssrLoadModule('/src/components/RenderBoundary.tsx'),
    vite.ssrLoadModule('/src/lib/motionFeatures.ts'),
  ]);
  awaitableLazyMotion = motion.LazyMotion; awaitableMotionConfig = motion.MotionConfig;
  const template = await readFile(resolve(dist, 'index.html'), 'utf8');
  const appShell = template
    .replace(/<title>.*?<\/title>/s, '<title>Morgan workspace</title>')
    .replace(/\s*<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g, '')
    .replace(/\s*<link\s+rel="canonical"[^>]*>/g, '')
    .replace('</head>', '  <meta name="robots" content="noindex, nofollow">\n</head>');
  await writeFile(resolve(dist, 'spa.html'), appShell);
  const { Home: _Home, Features, Pricing, About, Resources, ResourceDetail, Faq, Contact, NotFound } = pages;
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Organization', name: 'Morgan', url: `${origin}/`, logo: `${origin}/favicon.svg`, description: 'Financial management and business insight for marketing and digital agencies.' },
    { '@type': 'WebSite', name: 'Morgan', url: `${origin}/` },
  ] };
  const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  for (const entry of entries) {
    const markup = renderToString(publicTree({ AuthProvider: auth.AuthProvider, PublicLayout: layout.PublicLayout, Home: home.default, Features, Pricing, About, Resources, ResourceDetail, Faq, Contact, NotFound, AgencyPage: agency.AgencyPage, ToastProvider: ui.ToastProvider, RenderBoundary: boundary.RenderBoundary, motionFeatures: featureModule.default, location: entry.path }));
    const indexable = entry.indexable !== false;
    const canonical = `${origin}${entry.path}`;
    const metadata = [
      `<title>${escape(entry.title)} | Morgan</title>`,
      `<meta name="description" content="${escape(entry.description)}">`,
      `<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}">`,
      ...(indexable ? [
        `<link rel="canonical" href="${canonical}">`,
        `<meta property="og:title" content="${escape(entry.title)} | Morgan">`,
        `<meta property="og:description" content="${escape(entry.description)}">`,
        '<meta property="og:type" content="website">',
        `<meta property="og:url" content="${canonical}">`,
        '<meta property="og:site_name" content="Morgan">',
        `<meta property="og:image" content="${origin}/og-image.png">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:title" content="${escape(entry.title)} | Morgan">`,
        `<meta name="twitter:description" content="${escape(entry.description)}">`,
        `<meta name="twitter:image" content="${origin}/og-image.png">`,
      ] : []),
      ...(entry.schema ? [`<script id="morgan-page-schema" type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`] : []),
    ].join('\n  ');
    let html = template
      .replace(/<title>.*?<\/title>/s, '')
      .replace(/\s*<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/g, '')
      .replace(/\s*<link\s+rel="canonical"[^>]*>/g, '')
      .replace('<div id="root"></div>', `<div id="root" data-morgan-ssr="true">${markup}</div>`)
      .replace('</head>', `  ${metadata}\n</head>`);
    const destination = resolve(dist, entry.output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html);
    console.log(`Pre-rendered ${entry.path} → ${entry.output}`);
  }
} finally {
  await vite.close();
}
