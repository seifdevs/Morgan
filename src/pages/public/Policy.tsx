import { Link, Navigate, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/hooks';
import documents from '../../../shared/policies.json';

type PolicyDocument = typeof documents[number];

export default function Policy() {
  const { slug } = useParams();
  const document = (documents as PolicyDocument[]).find((item) => item.slug === slug);
  useDocumentTitle(document?.label || 'Policies', document ? `${document.label} for Morgan Financial.` : 'Morgan Financial policies.', { indexable: Boolean(document) });
  if (!document) return <Navigate to="/" replace />;
  return <article className="page policy-page">
    <header className="policy-header"><span className="eyebrow">Morgan Financial / Policies</span><h1>{document.label}</h1></header>
    <div className="policy-copy">{document.paragraphs.map((paragraph, index) => index === 0 && paragraph.text === `Morgan ${document.label}` ? null : paragraph.kind === 'heading'
      ? <h2 key={index}>{paragraph.text}</h2>
      : <p key={index}>{paragraph.text}</p>)}</div>
    <nav className="policy-switcher" aria-label="Morgan policies">{documents.map((item) => <Link key={item.id} to={`/policies/${item.slug}`} aria-current={item.id === document.id ? 'page' : undefined}>{item.label}</Link>)}</nav>
  </article>;
}
