import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type GeminiAnswer, type Horizon as HorizonData, type HorizonScenario, type ScenarioAssumption } from '../../lib/api';
import { ChartFrame, LineChart } from '../../components/charts/charts';
import { ErrorBox, Icon, LoadingRows, PageHeader } from '../../components/ui';
import { formatDate, formatDay } from '../../lib/dates';
import { useApi, useDocumentTitle, useMoney } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { centsToInput, toCents } from '../../../shared/money.js';

const kinds: { value: ScenarioAssumption['type']; label: string }[] = [
  { value: 'hire', label: 'Hire a team member' }, { value: 'lost-client', label: 'Lose a client' }, { value: 'delayed-payments', label: 'Delay client payments' },
  { value: 'new-client', label: 'Add a new client' }, { value: 'increased-expense', label: 'Increase recurring expenses' }, { value: 'large-purchase', label: 'Make a large purchase' },
];
const resetDate = (iso: string) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC';
type ChatLine = { role: 'user'|'assistant'; text: string; recommendations?: string[]; evidence?: GeminiAnswer['evidence'] };

export default function Horizon() {
  useDocumentTitle('Horizon');
  const money = useMoney();
  const { business } = useAuth();
  const [period, setPeriod] = useState(30);
  const [grain, setGrain] = useState<'daily'|'weekly'>('weekly');
  const [scenarioId, setScenarioId] = useState('');
  const path = `/horizon?days=${period}${scenarioId ? `&scenarioId=${encodeURIComponent(scenarioId)}` : ''}`;
  const horizon = useApi<HorizonData>(path);
  const scenarios = useApi<HorizonScenario[]>('/horizon/scenarios');
  const usage = useApi<{ capabilities: { forecastDays: number; scenariosPerWorkspace: { used: number; limit: number } }; usage: { intelligenceRequests: { used: number; limit: number; remaining: number } }; period: { resetsAt: string } }>('/usage');
  const [showScenario, setShowScenario] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [assumptions, setAssumptions] = useState<ScenarioAssumption[]>([]);
  const [scenarioError, setScenarioError] = useState('');
  const [amountInputs, setAmountInputs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [threadId, setThreadId] = useState('');
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatError, setChatError] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const pendingChatRequest = useRef<{ question: string; requestId: string } | null>(null);
  const data = horizon.data;
  const maxDays = usage.data?.capabilities.forecastDays || 30;
  const scenarioLimit = usage.data?.capabilities.scenariosPerWorkspace;
  const visibleRows = data?.forecasts.base.slice(0, period) || [];
  const lowPoint = visibleRows.reduce<(typeof visibleRows)[number] | null>((low, row) => row.balanceCents !== null && (!low || row.balanceCents < low.balanceCents!) ? row : low, null);
  const sampleRows = useMemo(() => {
    const stride = grain === 'weekly' ? 7 : 1;
    return visibleRows.filter((_, i) => i % stride === stride - 1 || i === visibleRows.length - 1);
  }, [visibleRows, grain]);
  const chartLabels = ['Today', ...sampleRows.map((r) => grain === 'weekly' ? formatDay(r.date) : formatDate(r.date))];
  const chartSeries = useMemo(() => {
    if (!data) return [];
    const balance = (mode: 'conservative'|'base'|'optimistic') => [null, ...sampleRows.map((r) => data.forecasts[mode].find((x) => x.date === r.date)?.balanceCents ?? null)];
    const series = [
      { key: 'recorded', label: 'Recorded starting cash', color: '#c9a86a', values: [data.openingBalanceCents, ...sampleRows.map(() => null)] },
      { key: 'conservative', label: 'Conservative estimate', color: '#8d98a5', dashed: true, values: balance('conservative') },
      { key: 'base', label: 'Base estimate', color: '#c9a86a', dashed: true, values: balance('base') },
      { key: 'optimistic', label: 'Optimistic estimate', color: '#2f9b70', dashed: true, values: balance('optimistic') },
    ];
    if (data.baseForecast && data.scenario) series.push({ key: 'business-base', label: 'Business forecast (no scenario)', color: '#8d98a5', dashed: true, values: [null, ...sampleRows.map((r) => data.baseForecast!.base.find((x) => x.date === r.date)?.balanceCents ?? null)] });
    return series;
  }, [data, sampleRows]);

  function startCreate() {
    setEditingId(''); setScenarioName('');
    setAssumptions([{ type: 'hire', name: 'New hire', startDate: data?.today || new Date().toISOString().slice(0, 10), amountCents: 0, cadence: 'monthly', durationMonths: null }]);
    setAmountInputs(['']);
    setScenarioError(''); setShowScenario(true);
  }
  function startEdit(item: HorizonScenario) {
    setEditingId(item.id); setScenarioName(item.name); setAssumptions(item.assumptions); setScenarioError(''); setShowScenario(true);
    setAmountInputs(item.assumptions.map((a) => a.amountCents ? centsToInput(a.amountCents) : ''));
  }
  function updateAssumption(index: number, patch: Partial<ScenarioAssumption>) { setAssumptions((current) => current.map((a, i) => i === index ? { ...a, ...patch } : a)); }
  function selectScenario(id: string) { setScenarioId(id); setThreadId(''); setChat([]); setChatError(''); pendingChatRequest.current = null; }
  async function saveScenario(e: FormEvent) {
    e.preventDefault(); setScenarioError(''); setBusy(true);
    const prepared = assumptions.map((a, i) => ({ ...a, amountCents: a.type === 'delayed-payments' ? undefined : toCents(amountInputs[i] || '') }));
    if (prepared.some((a) => a.type !== 'delayed-payments' && (!a.amountCents || a.amountCents < 1))) { setScenarioError('Enter a valid amount greater than zero for each assumption, with up to two decimal places.'); setBusy(false); return; }
    const body = { name: scenarioName, assumptions: prepared.map((a) => ({ ...a, startDate: a.startDate || data?.today })) };
    try {
      const saved = await api<HorizonScenario>(editingId ? `/horizon/scenarios/${editingId}` : '/horizon/scenarios', { method: editingId ? 'PATCH' : 'POST', body });
      selectScenario(saved.id); setShowScenario(false); scenarios.reload(); horizon.reload();
    } catch (e) { setScenarioError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function deleteScenario(item: HorizonScenario) {
    if (!window.confirm(`Delete scenario “${item.name}”?`)) return;
    try { await api(`/horizon/scenarios/${item.id}`, { method: 'DELETE' }); if (scenarioId === item.id) selectScenario(''); scenarios.reload(); }
    catch (e) { setScenarioError((e as Error).message); }
  }
  async function ask(e: FormEvent) {
    e.preventDefault(); if (!question.trim()) return;
    const text = question.trim(), retrying = pendingChatRequest.current?.question === text;
    setQuestion(''); setChatError(''); setChatBusy(true);
    if (!retrying) setChat((rows) => [...rows, { role: 'user', text }]);
    const requestId = retrying ? pendingChatRequest.current!.requestId : crypto.randomUUID();
    pendingChatRequest.current = { question: text, requestId };
    try {
      const answer = await api<GeminiAnswer>('/gemini/ask', { method: 'POST', body: { question: text, requestId, ...(threadId && { threadId }), ...(scenarioId && { scenarioId }) } });
      if (pendingChatRequest.current?.requestId === requestId) pendingChatRequest.current = null;
      setThreadId(answer.threadId); setChat((rows) => [...rows, { role: 'assistant', text: answer.answer, recommendations: answer.recommendations, evidence: answer.evidence }]); usage.reload();
    } catch (e) { setChatError((e as Error).message); }
    finally { setChatBusy(false); }
  }

  return <>
    <PageHeader eyebrow="Horizon" title="See the cash ahead" description={`A ${maxDays}-day view of expected cash movements, grounded in your invoices, bills, plans and recorded activity.`} actions={<>
      <label className="visually-hidden" htmlFor="horizon-period">Forecast period</label><select className="select" id="horizon-period" value={period} onChange={(e) => setPeriod(Number(e.target.value))}><option value={30}>30 days</option><option value={60} disabled={maxDays < 60}>60 days{maxDays < 60 ? ' · Pro' : ''}</option><option value={90} disabled={maxDays < 90}>90 days{maxDays < 90 ? ' · Pro' : ''}</option></select>
      <button className="btn primary" onClick={startCreate} disabled={!!scenarioLimit && scenarioLimit.used >= scenarioLimit.limit}><Icon name="plus" size={16} />Create scenario</button>
    </>} />
    {maxDays < 90 && <div className="callout info section-gap"><Icon name="alert" size={16} /><span>Starter includes a 30-day Horizon. Longer forecasts are available on Pro and Max.</span><Link className="link" to="/pricing">Review plans</Link></div>}
    {scenarioLimit && scenarioLimit.used >= scenarioLimit.limit && <div className="callout info section-gap"><Icon name="alert" size={16} /><span>You have {scenarioLimit.used} saved scenario{scenarioLimit.used === 1 ? '' : 's'}, the Starter limit. Delete one before creating another.</span></div>}
    {horizon.error && <ErrorBox message={horizon.error} onRetry={horizon.reload} />}
    {horizon.loading && !data && <section className="panel"><LoadingRows rows={8} /></section>}
    {data && <>
      <section className="statement horizon-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi hero-kpi"><span className="kpi-label"><span className="badge paid">Recorded starting cash</span></span><span className="kpi-value num">{data.openingBalanceCents === null ? 'Unavailable' : money(data.openingBalanceCents)}</span><span className="kpi-foot">{data.cashAsOf ? `as of ${formatDate(data.cashAsOf)} · historical, not live` : 'Set a dated balance in Settings'}</span></div>
        <div className="kpi"><span className="kpi-label"><span className="badge estimate">Base estimate</span></span><span className="kpi-value num">{data.forecasts.base[period - 1]?.balanceCents == null ? 'Unavailable' : money(data.forecasts.base[period - 1].balanceCents!)}</span><span className="kpi-foot">projected at day {period}</span></div>
        <div className="kpi"><span className="kpi-label">Lowest base point</span><span className="kpi-value num">{lowPoint ? money(lowPoint.balanceCents!) : 'Unavailable'}</span><span className="kpi-foot">{lowPoint ? formatDate(lowPoint.date) : 'Starting cash is needed'}</span></div>
        <div className="kpi"><span className="kpi-label">Forecast confidence</span><span className="kpi-value num">{data.confidence.score}%</span><span className="kpi-foot">{data.confidence.level} · {data.confidence.historyDays} days of history</span></div>
      </section>
      {!data.hasOpeningBalance && <div className="callout info section-gap"><Icon name="alert" size={16} /><span>Cash movements are projected, but balance totals need a dated opening balance or statement close.</span><a className="link" href="/app/settings#business">Set starting cash</a></div>}
      {data.cashMissingAccounts?.length ? <div className="callout section-gap"><Icon name="alert" size={16} /><span>Balance is incomplete: {data.cashMissingAccounts.join(', ')} have no dated balance.</span></div> : null}
      <ChartFrame title="Projected balances" aside={<div className="segmented-control" role="group" aria-label="Chart interval"><button className={grain === 'weekly' ? 'selected' : ''} onClick={() => setGrain('weekly')}>Weekly</button><button className={grain === 'daily' ? 'selected' : ''} onClick={() => setGrain('daily')}>Daily</button></div>} note={`Base assumptions: ${data.assumptions.collectionRates.base}. ${data.assumptions.paymentTiming} Bills are included in full. Recent unlinked cash activity continues at ${money(data.assumptions.runRateCentsPerDay)}/day; estimate lines are dashed.`}>
        <LineChart ariaLabel="Conservative, base and optimistic projected cash balances" labels={chartLabels} series={chartSeries} format={(v) => money(v, { compact: true })} height={300} markIndex={0} markLabel="Recorded today" />
      </ChartFrame>
      <div className="grid cols-2 section-gap">
        <section className="panel"><div className="panel-head"><div><h2>Forecast range</h2><p>Base, conservative and optimistic estimates from the same records.</p></div><span className="badge estimate">Estimate</span></div><div className="table-wrap"><table className="table"><thead><tr><th>Period</th><th className="r">Conservative</th><th className="r">Base</th><th className="r">Optimistic</th></tr></thead><tbody>{data.checkpoints.map((row) => <tr key={row.days}><td><b>{row.days} days</b></td><td className="amount">{row.conservativeCents === null ? '—' : money(row.conservativeCents)}</td><td className="amount">{row.baseCents === null ? '—' : money(row.baseCents)}</td><td className="amount">{row.optimisticCents === null ? '—' : money(row.optimisticCents)}</td></tr>)}</tbody></table></div><div className="panel-body"><p className="muted">Confidence uses record history, transaction classification and the share of confirmed scheduled items. It describes data coverage, not a guarantee of payment.</p></div></section>
        <section className="panel"><div className="panel-head"><div><h2>Scenario simulations</h2><p>Saved assumptions are evaluated against the live forecast engine.</p></div></div>
          {scenarios.error && <div className="panel-body"><ErrorBox message={scenarios.error} onRetry={scenarios.reload} /></div>}
          {scenarios.loading && !scenarios.data ? <div className="panel-body"><LoadingRows rows={2} /></div> : scenarios.data?.length ? <div className="scenario-list">{scenarios.data.map((item) => <div className={`scenario-row ${scenarioId === item.id ? 'active' : ''}`} key={item.id}>
            <button className="scenario-select" onClick={() => selectScenario(scenarioId === item.id ? '' : item.id)}><b>{item.name}</b><small>{item.assumptions.map((a) => `${a.name}${a.amountCents ? ` · ${money(a.amountCents)}` : ` · ${a.delayDays} days`}`).join('; ')}</small></button>
            <button className="btn ghost sm" aria-label={`Edit ${item.name}`} onClick={() => startEdit(item)}><Icon name="edit" size={14} /></button><button className="btn ghost sm" aria-label={`Delete ${item.name}`} onClick={() => deleteScenario(item)}><Icon name="trash" size={14} /></button>
          </div>)}</div> : <div className="panel-body muted">No scenarios saved yet. Model a hire, client change, payment delay or large purchase.</div>}
          {data.scenario && <div className="panel-body scenario-result"><b>{data.scenario.name} impact</b><p className="muted">Recalculated using saved records plus this scenario. These assumptions do not alter your ledger.</p>{data.checkpoints.map((row) => { const current = data.forecasts.base[row.days - 1]?.balanceCents; const baseline = data.baseForecast?.base[row.days - 1]?.balanceCents; const delta = current == null || baseline == null ? null : current - baseline; return <p key={row.days}>{row.days} days: <span className="num">{current == null ? '—' : money(current)}</span>{delta !== null && <span className={`num ${delta < 0 ? 'neg' : 'pos'}`}> · {money(delta, { sign: true })} vs base</span>}</p>; })}</div>}
        </section>
      </div>
      <section className="panel section-gap"><div className="panel-head"><div><h2>Scheduled cash movements</h2><p>Base estimates probability-weight client receipts and saved expectations. Bills are included in full.</p></div></div><div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Source</th><th>Movement</th><th>Confidence and timing</th><th className="r">Base estimate</th></tr></thead><tbody>{data.events.length ? data.events.filter((e) => e.date <= data.forecasts.base[period - 1]?.date).map((event, index) => <tr key={`${event.type}-${event.id}-${event.date}-${index}`}><td>{formatDate(event.date)}</td><td><span className="badge estimate">{event.type}</span></td><td><b>{event.label}</b></td><td>{event.confidence === 'scenario' ? 'Scenario input' : event.confidence}{event.paymentPrediction && <small className="sub">{event.paymentPrediction.observations ? `${event.paymentPrediction.delayDays > 0 ? '+' : ''}${event.paymentPrediction.delayDays} days vs due date · ${event.paymentPrediction.observations} prior paid` : 'Due date used · no paid history'}</small>}</td><td className={`amount ${event.projectedAmountCents > 0 ? 'pos' : ''}`}>{money(event.projectedAmountCents, { sign: true })}</td></tr>) : <tr><td colSpan={5} className="muted">No invoice, bill or saved plan movements in this period. Run-rate remains a separate estimate.</td></tr>}</tbody></table></div></section>
      <section className="panel section-gap horizon-gemini"><div className="panel-head"><div><h2>Ask Morgan</h2><p>Gemini explains the records and calculations shown above. It cannot change your financial data.</p>{usage.data?.usage.intelligenceRequests && <p className="muted">{usage.data.usage.intelligenceRequests.used} of {usage.data.usage.intelligenceRequests.limit} messages used this month · resets {resetDate(usage.data.period.resetsAt)}</p>}</div><span className="badge estimate">AI explanation</span></div>
        {usage.data?.usage.intelligenceRequests && usage.data.usage.intelligenceRequests.used / usage.data.usage.intelligenceRequests.limit >= .8 && <div className="callout info" role="status"><Icon name="alert" size={16} /><span>{usage.data.usage.intelligenceRequests.remaining === 0 ? 'Your monthly Morgan Intelligence allowance is used. It resets at the start of next month; you can review plan options.' : 'You have used at least 80% of this month’s Morgan Intelligence allowance.'}</span>{usage.data.usage.intelligenceRequests.remaining === 0 && <Link className="link" to="/app/usage">Plan & usage</Link>}</div>}
        <div className="gemini-thread" aria-live="polite">{chat.length ? chat.map((line, i) => <div key={`${i}-${line.role}`} className={`gemini-message ${line.role}`}><b>{line.role === 'user' ? 'You' : 'Morgan'}</b><p>{line.text}</p>{line.recommendations?.length ? <ul>{line.recommendations.map((rec) => <li key={rec}>{rec}</li>)}</ul> : null}{line.evidence?.length ? <details className="gemini-evidence"><summary>Records supporting this answer ({line.evidence.length})</summary><ul>{line.evidence.map((ev) => <li key={ev.id}><span>{ev.label}</span><small>{formatDate(ev.date)} · {money(ev.amountCents, { sign: true })}</small></li>)}</ul></details> : null}</div>) : <p className="muted">Ask about a projected change, a saved scenario, outstanding invoices or the records behind an alert.</p>}{chatBusy && <p className="muted">Morgan is checking the financial context…</p>}</div>
        {chatError && <div className="panel-body"><ErrorBox message={chatError} onRetry={() => setChatError('')} /></div>}
        <form className="gemini-form" onSubmit={ask}><label className="visually-hidden" htmlFor="gemini-question">Ask a financial question</label><input className="input" id="gemini-question" maxLength={1200} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why does projected cash fall in week 8?" disabled={chatBusy || usage.data?.usage.intelligenceRequests.remaining === 0} /><button className="btn primary" disabled={chatBusy || !question.trim() || usage.data?.usage.intelligenceRequests.remaining === 0}><Icon name="arrowRight" size={15} />Ask</button></form>
      </section>
      {showScenario && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShowScenario(false)}><form className="modal scenario-modal" onSubmit={saveScenario} aria-labelledby="scenario-title"><div className="modal-head"><div><span className="eyebrow gold">Horizon scenario</span><h2 id="scenario-title">{editingId ? 'Edit scenario' : 'Create scenario'}</h2></div><button type="button" className="btn ghost icon sm" aria-label="Close" onClick={() => setShowScenario(false)}><Icon name="close" /></button></div>
        <div className="form-grid"><div className="field"><label htmlFor="scenario-name">Scenario name</label><input className="input" id="scenario-name" required maxLength={100} value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} placeholder="Bring on a new designer" /></div></div>
        <div className="scenario-assumptions">{assumptions.map((a, index) => <fieldset className="scenario-assumption" key={index}><legend>Assumption {index + 1}</legend>
          <div className="form-grid two"><div className="field"><label htmlFor={`scenario-type-${index}`}>What changes?</label><select className="select" id={`scenario-type-${index}`} value={a.type} onChange={(e) => { const type = e.target.value as ScenarioAssumption['type']; updateAssumption(index, { type, cadence: type === 'large-purchase' ? 'once' : type === 'delayed-payments' ? undefined : 'monthly', ...(type === 'delayed-payments' && { delayDays: 14 }) }); }} >{kinds.map((kind) => <option value={kind.value} key={kind.value}>{kind.label}</option>)}</select></div>
            <div className="field"><label htmlFor={`assumption-name-${index}`}>Description</label><input className="input" id={`assumption-name-${index}`} required value={a.name} onChange={(e) => updateAssumption(index, { name: e.target.value })} /></div>
            <div className="field"><label htmlFor={`assumption-date-${index}`}>Starting date</label><input className="input" id={`assumption-date-${index}`} type="date" required value={a.startDate || data?.today || ''} onChange={(e) => updateAssumption(index, { startDate: e.target.value })} /></div>
            {a.type === 'delayed-payments' ? <div className="field"><label htmlFor={`delay-days-${index}`}>Delay all open invoice receipts by (days)</label><input className="input" id={`delay-days-${index}`} type="number" min="1" max="90" required value={a.delayDays || 14} onChange={(e) => updateAssumption(index, { delayDays: Number(e.target.value) })} /><span className="hint">Applies to outstanding invoices in the forecast.</span></div> : <>
              <div className="field"><label htmlFor={`assumption-amount-${index}`}>Amount ({business?.currency || 'business currency'})</label><input className="input num" id={`assumption-amount-${index}`} inputMode="decimal" required value={amountInputs[index] || ''} onChange={(e) => setAmountInputs((current) => current.map((v, i) => i === index ? e.target.value : v))} placeholder="0.00" /></div>
              <div className="field"><label htmlFor={`assumption-cadence-${index}`}>Frequency</label><select className="select" id={`assumption-cadence-${index}`} value={a.cadence || (a.type === 'large-purchase' ? 'once' : 'monthly')} onChange={(e) => updateAssumption(index, { cadence: e.target.value as ScenarioAssumption['cadence'] })}><option value="once">One time</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
              {(a.cadence || 'monthly') !== 'once' && <div className="field"><label htmlFor={`assumption-duration-${index}`}>Duration in months · optional</label><input className="input" id={`assumption-duration-${index}`} type="number" min="1" max="36" value={a.durationMonths || ''} onChange={(e) => updateAssumption(index, { durationMonths: e.target.value ? Number(e.target.value) : null })} placeholder="Through forecast" /></div>}
            </>}
            {assumptions.length > 1 && <button type="button" className="btn ghost sm" onClick={() => { setAssumptions((current) => current.filter((_, i) => i !== index)); setAmountInputs((current) => current.filter((_, i) => i !== index)); }}>Remove assumption</button>}
          </div>
        </fieldset>)}</div><button type="button" className="btn outline sm" disabled={assumptions.length >= 12} onClick={() => { setAssumptions((current) => [...current, { type: 'increased-expense', name: 'Additional expense', startDate: data?.today || '', amountCents: 0, cadence: 'monthly', durationMonths: null }]); setAmountInputs((current) => [...current, '']); }}><Icon name="plus" size={14} />Add assumption</button>
        {scenarioError && <div className="form-error" role="alert">{scenarioError}</div>}<div className="modal-foot"><button type="button" className="btn outline" onClick={() => setShowScenario(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Save scenario'}</button></div>
      </form></div>}
    </>}
  </>;
}
