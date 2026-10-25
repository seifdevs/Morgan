import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LazyMotion, MotionConfig } from 'motion/react';
const motionFeatures = () => import('./lib/motionFeatures').then((m) => m.default);
import { AuthProvider } from './lib/auth';
import { ScrollManager } from './lib/scroll';
import { ToastProvider, LoadingRows } from './components/ui';
import { RenderBoundary } from './components/RenderBoundary';
import { PublicLayout } from './pages/public/PublicLayout';
import Home from './pages/public/Home';
import { About, Contact, Faq, Features, NotFound, Pricing, ResourceDetail, Resources } from './pages/public/Pages';
import { Auth, ForgotPassword, ResetPassword } from './pages/public/Auth';
import { Logout, RequireAuth } from './pages/app/AppLayout';
import './styles/base.css';
import './styles/public.css';
import './styles/home.css';
import './styles/hero.css';
import './styles/app.css';
import './styles/illustrations.css';
import './styles/system.css';

// The workspace is split into its own chunks so the marketing site stays light.
const Overview = lazy(() => import('./pages/app/Overview'));
const Transactions = lazy(() => import('./pages/app/Transactions'));
const BankAccounts = lazy(() => import('./pages/app/BankAccounts'));
const Spending = lazy(() => import('./pages/app/Spending'));
const Insights = lazy(() => import('./pages/app/Spending').then((m) => ({ default: m.Insights })));
const Invoices = lazy(() => import('./pages/app/Invoices'));
const InvoiceEditor = lazy(() => import('./pages/app/Invoices').then((m) => ({ default: m.InvoiceEditor })));
const InvoiceDetail = lazy(() => import('./pages/app/Invoices').then((m) => ({ default: m.InvoiceDetail })));
const Customers = lazy(() => import('./pages/app/Billing').then((m) => ({ default: m.Customers })));
const Receivables = lazy(() => import('./pages/app/Billing').then((m) => ({ default: m.Receivables })));
const Bills = lazy(() => import('./pages/app/Billing').then((m) => ({ default: m.Bills })));
const CashFlow = lazy(() => import('./pages/app/Planning').then((m) => ({ default: m.CashFlow })));
const Reports = lazy(() => import('./pages/app/Planning').then((m) => ({ default: m.Reports })));
const Settings = lazy(() => import('./pages/app/Settings'));
const FinancialOnboarding = lazy(() => import('./pages/app/FinancialOnboarding'));

const page = (el: React.ReactNode) => <Suspense fallback={<div className="panel"><LoadingRows rows={6} /></div>}>{el}</Suspense>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={motionFeatures} strict>
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <ScrollManager />
      <AuthProvider>
        <ToastProvider>
          <RenderBoundary>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<Home />} />
              <Route path="features" element={<Features />} />
              <Route path="product/*" element={<Features />} />
              <Route path="pricing" element={<Pricing />} />
              <Route path="about" element={<About />} />
              <Route path="resources" element={<Resources />} />
              <Route path="resources/:slug" element={<ResourceDetail />} />
              <Route path="faq" element={<Faq />} />
              <Route path="contact" element={<Contact />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="login" element={<Auth mode="login" />} />
            <Route path="signup" element={<Auth mode="signup" />} />
            <Route path="logout" element={<Logout />} />
            <Route path="forgot-password" element={<ForgotPassword />} />
            <Route path="reset-password" element={<ResetPassword />} />
            <Route path="app" element={<RequireAuth />}>
              <Route path="onboarding" element={page(<FinancialOnboarding />)} />
              <Route index element={page(<Overview />)} />
              <Route path="spending" element={page(<Spending />)} />
              <Route path="transactions" element={page(<Transactions />)} />
              <Route path="bank-accounts" element={page(<BankAccounts />)} />
              <Route path="insights" element={page(<Insights />)} />
              <Route path="invoices" element={page(<Invoices />)} />
              <Route path="invoices/new" element={page(<InvoiceEditor />)} />
              <Route path="invoices/:id" element={page(<InvoiceDetail />)} />
              <Route path="invoices/:id/edit" element={page(<InvoiceEditor />)} />
              <Route path="customers" element={page(<Customers />)} />
              <Route path="receivables" element={page(<Receivables />)} />
              <Route path="bills" element={page(<Bills />)} />
              <Route path="payables" element={page(<Bills />)} />
              <Route path="cashflow" element={page(<CashFlow />)} />
              <Route path="forecast" element={page(<CashFlow />)} />
              <Route path="advisor" element={page(<Insights />)} />
              <Route path="reports" element={page(<Reports />)} />
              <Route path="settings" element={page(<Settings />)} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
          </RenderBoundary>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
