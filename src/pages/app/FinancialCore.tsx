import { Link } from 'react-router-dom';
import { Icon, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../lib/hooks';

const destinations = [
  ['/app/transactions', 'Transactions', 'Review and classify recorded cash movements.', 'transfer'],
  ['/app/invoices', 'Invoices and receivables', 'Create invoices, record receipts and follow what clients owe.', 'document'],
  ['/app/bills', 'Bills and payables', 'Track amounts due and record payments.', 'payable'],
  ['/app/customers', 'Customers', 'Maintain the client records used on invoices.', 'users'],
  ['/app/bank-accounts', 'Bank accounts', 'Import statements, review matches and reconcile balances.', 'cash'],
  ['/app/spending', 'Spending', 'Compare recorded expenses and review recurring costs.', 'pie'],
  ['/app/cashflow', 'Cash flow planning', 'Manage dated expectations and monthly guardrails used by Horizon.', 'trend'],
] as const;

export default function FinancialCore() {
  useDocumentTitle('Financial Core');
  return <>
    <PageHeader eyebrow="Financial Core" title="Your business ledger" description="Every figure here comes from a transaction, invoice, bill or statement you saved in Morgan." />
    <div className="grid cols-2 section-gap">{destinations.map(([to, title, description, icon]) => <Link className="panel financial-core-link" to={to} key={to}>
      <div className="panel-head"><h2>{title}</h2><Icon name={icon} size={18} /></div>
      <div className="panel-body"><p className="muted">{description}</p><span className="link">Open {title.toLowerCase()} <Icon name="arrowRight" size={14} /></span></div>
    </Link>)}</div>
  </>;
}
