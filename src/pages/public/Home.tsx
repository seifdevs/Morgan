import { useDocumentTitle } from '../../lib/hooks';
import { MoneyFlow } from '../../components/MoneyFlow';
import { LedgerHero } from '../../components/LedgerHero';
import { ProblemSection, PillarExplorer, HorizonShowcase, MonitorShowcase, IntelligenceShowcase, ReportShowcase, WorkflowSection, PricingShowcase, MarketingFaq, ClosingSection } from '../../components/MarketingExperience';

const homeSchema = [
  { '@type': 'Organization', name: 'Morgan', url: 'https://morganhq.site/', logo: 'https://morganhq.site/favicon.svg', description: 'A financial workspace for business records, monitoring, cash forecasts, scenarios and contextual explanations.' },
  { '@type': 'WebSite', name: 'Morgan', url: 'https://morganhq.site/' },
];

export default function Home() {
  useDocumentTitle('Four ledgers. One picture.', 'Your business has financial records. Morgan brings them together, shows you what is changing, and helps you understand what comes next.', { schema: homeSchema });
  return <div className="home mx-home">
    <LedgerHero />
    <ProblemSection />
    <PillarExplorer />
    <MoneyFlow />
    <HorizonShowcase />
    <MonitorShowcase />
    <IntelligenceShowcase />
    <ReportShowcase />
    <WorkflowSection />
    <PricingShowcase />
    <MarketingFaq />
    <ClosingSection />
  </div>;
}
