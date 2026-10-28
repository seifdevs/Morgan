import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sendMail, notifyMail, listLocalEmailPreviews, localEmailPreviewEnabled } from '../server/lib/mail.mjs';

let originalFetch, originalEnv;
const sent = [];
let nextResponse;

before(() => {
  originalFetch = globalThis.fetch;
  originalEnv = Object.fromEntries(['RESEND_API_KEY', 'MAIL_FROM', 'MORGAN_RUNTIME_MODE', 'MORGAN_EMAIL_PREVIEW', 'MORGAN_EMAIL_TEST_OVERRIDE', 'RESEND_TEST_TO'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { RESEND_API_KEY: 'server-test-key-do-not-leak', MAIL_FROM: 'Morgan <no-reply@example.test>' });
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.resend.com/emails')) return originalFetch(url, options);
    sent.push({ url: String(url), authorization: new Headers(options.headers).get('authorization'), message: JSON.parse(options.body) });
    return nextResponse || new Response(JSON.stringify({ id: 'resend_unit_accepted' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv || {})) value === undefined ? delete process.env[key] : process.env[key] = value;
});

test('Resend SDK sends server-authenticated requests and reports provider acceptance accurately', async () => {
  nextResponse = null;
  const result = await sendMail({ to: 'seif.a7@icloud.com', subject: 'SDK acceptance test', text: 'A provider acceptance test.' });
  assert.deepEqual(result, { id: 'resend_unit_accepted', status: 'accepted' });
  assert.equal(sent.at(-1).authorization, 'Bearer server-test-key-do-not-leak');
  assert.equal(sent.at(-1).message.to[0], 'seif.a7@icloud.com');
});

test('invalid recipients are rejected before calling Resend', async () => {
  const count = sent.length;
  await assert.rejects(sendMail({ to: 'not-an-email', subject: 'Invalid recipient', text: 'Never sent.' }), { code: 'INVALID_RECIPIENT', status: 400 });
  assert.equal(sent.length, count);
});

test('Resend rate limits and provider errors are classified without exposing credentials', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    nextResponse = new Response(JSON.stringify({ statusCode: 429, message: 'Rate limit exceeded', name: 'rate_limit_exceeded' }), { status: 429, headers: { 'content-type': 'application/json' } });
    const result = await notifyMail({ to: 'seif.a7@icloud.com', subject: 'Rate limit test', text: 'Test.' });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'RATE_LIMITED');
    assert.ok(!JSON.stringify(result).includes('server-test-key-do-not-leak'));
    assert.equal(sent.at(-1).authorization, 'Bearer server-test-key-do-not-leak');
  } finally { console.error = originalError; nextResponse = null; }
});

test('development preview capture and test-recipient override stay local', async () => {
  Object.assign(process.env, { MORGAN_RUNTIME_MODE: 'development', MORGAN_EMAIL_PREVIEW: '1', MORGAN_EMAIL_TEST_OVERRIDE: '1', RESEND_TEST_TO: 'seif.a7@icloud.com' });
  nextResponse = null;
  const result = await sendMail({ to: 'customer@example.com', kind: 'verification', subject: 'Verify', text: 'https://localhost/verify-email?token=secret-preview-token' });
  assert.equal(result.status, 'accepted');
  assert.equal(localEmailPreviewEnabled(), true);
  assert.equal(sent.at(-1).message.to[0], 'seif.a7@icloud.com');
  assert.match(sent.at(-1).message.subject, /^\[DEV TEST\]/);
  const preview = listLocalEmailPreviews()[0];
  assert.equal(preview.intendedRecipient, 'customer@example.com');
  assert.match(preview.text, /secret-preview-token/);

  process.env.MORGAN_RUNTIME_MODE = 'production';
  await sendMail({ to: 'customer@example.com', kind: 'verification', subject: 'Verify', text: 'A production message.' });
  assert.equal(sent.at(-1).message.to[0], 'customer@example.com');
  assert.doesNotMatch(sent.at(-1).message.subject, /^\[DEV TEST\]/);
  assert.equal(localEmailPreviewEnabled(), false);
  nextResponse = null;
});

test('a transport failure is unknown, not rejected or delivered', async () => {
  nextResponse = new Response(JSON.stringify({ name: 'application_error', statusCode: null, message: 'Unable to fetch data. The request could not be resolved.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  await assert.rejects(sendMail({ to: 'owner@example.com', subject: 'Network failure', text: 'Test.' }), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.deliveryStatus, 'unknown');
    return true;
  });
  nextResponse = null;
});
