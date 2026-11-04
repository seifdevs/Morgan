import test from 'node:test';
import assert from 'node:assert/strict';
import { askGemini, validateGeminiAnswer } from '../server/lib/gemini.mjs';

test('Gemini call stays server authenticated and requests structured evidence-backed JSON', async () => {
  let request;
  const result = await askGemini({ question: 'Why is cash lower?', history: [{ role: 'user', content: 'Earlier question' }], financialContext: { cashBalanceCents: 1234 }, apiKey: 'test-secret', fetchImpl: async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'An expense is due.', citations: [{ recordId: 't1', label: 'Rent' }], recommendations: ['Review rent.'], unsupported: false }) }] } }] }), { status: 200 });
  } });
  assert.match(request.url, /generativelanguage.googleapis.com/);
  assert.equal(request.init.headers['x-goog-api-key'], 'test-secret');
  assert.equal(JSON.parse(request.init.body).generationConfig.responseMimeType, 'application/json');
  assert.match(JSON.parse(request.init.body).contents[0].parts[0].text, /Earlier question/);
  assert.match(JSON.parse(request.init.body).contents[0].parts[0].text, /1234/);
  assert.equal(result.answer, 'An expense is due.');
});

test('Gemini missing credential, timeout and rate-limit failure are explicit', async () => {
  await assert.rejects(askGemini({ question: 'What changed?', history: [], financialContext: {}, apiKey: '' }), { status: 503 });
  await assert.rejects(askGemini({ question: 'What changed?', history: [], financialContext: {}, apiKey: 'x', fetchImpl: async () => new Response('', { status: 429, headers: { 'retry-after': '17' } }) }), { status: 429, retryAfter: 17 });
  await assert.rejects(askGemini({ question: 'What changed?', history: [], financialContext: {}, apiKey: 'x', fetchImpl: async () => { const e = new Error('timeout'); e.name = 'AbortError'; throw e; } }), { status: 504 });
});

test('Gemini structured answer rejects malformed fields and filters invented citation IDs', () => {
  assert.throws(() => validateGeminiAnswer({ answer: 4, citations: [], recommendations: [], unsupported: false }, []));
  const result = validateGeminiAnswer({ answer: 'Based on the record.', citations: [{ recordId: 'real', label: 'Rent' }, { recordId: 'invented', label: 'Made up' }], recommendations: ['Check it.'], unsupported: false }, ['real']);
  assert.deepEqual(result.citations.map((c) => c.recordId), ['real']);
});
