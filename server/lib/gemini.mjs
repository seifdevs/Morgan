const schema = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING', maxLength: 2600 },
    citations: { type: 'ARRAY', maxItems: 4, items: { type: 'OBJECT', properties: { recordId: { type: 'STRING' }, label: { type: 'STRING' } }, required: ['recordId', 'label'] } },
    recommendations: { type: 'ARRAY', maxItems: 2, items: { type: 'STRING', maxLength: 280 } },
    unsupported: { type: 'BOOLEAN' },
  },
  required: ['answer', 'citations', 'recommendations', 'unsupported'],
};

const currencyAmountPattern = /(?:[+\-−]\s*)?(?:[$€£¥₹₽₺₩₦₱₫]|[A-Z]{3})[\s\u00a0]*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?[\s\u00a0]*(?:[$€£¥₹₽₺₩₦₱₫]|[A-Z]{3})/gu;
const normalizeAmount = (value) => value.replace(/[\s\u00a0,]/g, '').replaceAll('−', '-');
const safeFallback = () => ({ answer: 'I don’t have enough supported information to answer that accurately. Try asking about a specific invoice, expense, or forecast period.', citations: [], recommendations: [], unsupported: true });
export function formattedMoneyValues(context) { return JSON.stringify(context).match(currencyAmountPattern) || []; }

export function validateGeminiAnswer(value, allowedIds, allowedAmounts = null) {
  if (!value || typeof value.answer !== 'string' || value.answer.length > 2600 || !Array.isArray(value.citations) || !Array.isArray(value.recommendations) || typeof value.unsupported !== 'boolean') throw new Error('Gemini returned an invalid financial response.');
  const ids = new Set(allowedIds);
  const citations = value.citations.filter((c) => c && typeof c.recordId === 'string' && ids.has(c.recordId) && typeof c.label === 'string').slice(0, 12);
  const recommendations = value.recommendations.filter((r) => typeof r === 'string').map((r) => r.trim().slice(0, 280)).filter(Boolean).slice(0, 2);
  const answer = value.answer.trim();
  const content = `${answer} ${recommendations.join(' ')}`;
  const internalDetail = /\b(?:amountCents|balanceDueCents|cashBalanceCents|recordId|invoicePaymentPredictions|weeklyResults|JSON|API|database|deterministic engine|source[_ -]?\d+)\b/i.test(content);
  if (internalDetail || /\bcents\b/i.test(content)) {
    return safeFallback();
  }
  if (allowedAmounts) {
    const allowed = new Set([...allowedAmounts].map(normalizeAmount));
    const amounts = content.match(currencyAmountPattern) || [];
    if (amounts.some((amount) => !allowed.has(normalizeAmount(amount)))) return safeFallback();
  }
  return { answer, citations, recommendations, unsupported: value.unsupported };
}

export async function askGemini({ question, history, financialContext, fetchImpl = fetch, apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.8-flash' }) {
  if (!apiKey) {
    const error = new Error('Gemini is not configured. Add GEMINI_API_KEY on the server to enable financial intelligence.');
    error.status = 503; throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const prompt = [
      'You are Morgan, a clear-headed financial analyst speaking with a business owner. Sound natural, concise, confident and professional. Lead with the answer in ordinary business language. Explain what the figures mean for the business, not how the software stores or computes them.',
      'Answer the user’s actual question. Keep a simple answer to one or two sentences. Give deeper analysis only when requested or needed to explain a material risk. Avoid generic introductions, canned summaries, headings, repetition, and chatbot filler. Do not repeat the whole financial overview in a follow-up. Use prior conversation only to understand references and follow-up questions; current supplied facts take precedence.',
      'All amounts and forecast outcomes in the supplied context have already been calculated by Morgan. Never calculate, estimate, adjust, round, convert, or invent any monetary value, total, difference, percentage, or date. Quote a monetary amount only exactly as formatted in the context. If the user asks for a calculation that is not already supplied, say what information is missing instead of calculating it. Do not expose cents, internal field names, reference IDs, database details, JSON, or implementation language.',
      'Clearly distinguish recorded balances from forecast estimates. Projections are not guarantees. When discussing a scenario, put its base outcome first, distinguish conservative, base and optimistic outcomes, and explain the relevant assumptions. Mention uncertainty briefly and only when it changes how the answer should be interpreted. Identify risks and opportunities only when supported by supplied records. Offer at most one practical next step when useful; keep recommendations separate from the answer and do not repeat it.',
      'Use only supplied facts. Never make unsupported claims about performance or causes. If evidence is insufficient, say so plainly and set unsupported=true. Cite only supplied source references, and cite a source only when it directly supports the answer. Do not provide tax, legal, or regulated investment advice.',
      `FINANCIAL CONTEXT (all monetary amounts are formatted for display):\n${JSON.stringify(financialContext)}`,
      `RECENT CONVERSATION:\n${JSON.stringify(history)}`,
      `USER QUESTION:\n${question}`,
      'Before responding, check that the first sentence answers the question, every financial claim is supported, all monetary figures are copied exactly from the supplied context, and no technical or repeated detail remains.',
    ].join('\n\n');
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 650, responseMimeType: 'application/json', responseSchema: schema } }),
    });
    if (response.status === 429) { const e = new Error('Gemini is busy. Wait a moment and try again.'); e.status = 429; e.retryAfter = Number(response.headers.get('retry-after')) || 30; throw e; }
    if (!response.ok) { const e = new Error(response.status >= 500 ? 'Gemini is temporarily unavailable. Your financial records and forecasts are unaffected.' : 'Gemini could not process this question.'); e.status = response.status >= 500 ? 502 : 503; throw e; }
    const payload = await response.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
    if (!text) throw new Error('Gemini returned no answer.');
    const result = JSON.parse(text);
    result.usageMetadata = {
      promptTokenCount: Number.isSafeInteger(payload.usageMetadata?.promptTokenCount) ? payload.usageMetadata.promptTokenCount : null,
      candidatesTokenCount: Number.isSafeInteger(payload.usageMetadata?.candidatesTokenCount) ? payload.usageMetadata.candidatesTokenCount : null,
      totalTokenCount: Number.isSafeInteger(payload.usageMetadata?.totalTokenCount) ? payload.usageMetadata.totalTokenCount : null,
    };
    return result;
  } catch (error) {
    if (error.name === 'AbortError') { const e = new Error('Gemini took too long to respond. Try again.'); e.status = 504; throw e; }
    throw error;
  } finally { clearTimeout(timeout); }
}
