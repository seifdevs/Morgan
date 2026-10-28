import { createHash, randomUUID } from 'node:crypto';
import { Resend } from 'resend';

// Resend's SDK logs the full provider response in development. Suppress that
// output so provider messages never leak into logs; the sanitized result is
// recorded below instead.
class QuietResend extends Resend { logError() {} }

let client;
const resendClient = () => client ||= new QuietResend(process.env.RESEND_API_KEY);
const previews = [];
const isDevelopment = () => process.env.MORGAN_RUNTIME_MODE === 'development'
  && process.env.NODE_ENV !== 'production'
  && !process.argv.includes('--prod');

export const localEmailPreviewEnabled = () => isDevelopment() && process.env.MORGAN_EMAIL_PREVIEW === '1';
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

const redact = (value) => {
  let message = String(value || 'Email provider returned an error.');
  if (process.env.RESEND_API_KEY) message = message.split(process.env.RESEND_API_KEY).join('[credential redacted]');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [credential redacted]')
    .replace(/([?&](?:token|code|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[address redacted]')
    .slice(0, 500);
};

function categorize(status, providerMessage = '') {
  const detail = String(providerMessage).toLowerCase();
  if (status === 429) return 'RATE_LIMITED';
  if (detail.includes('suspend')) return 'ACCOUNT_SUSPENDED';
  if (detail.includes('compliance') || detail.includes('under review') || detail.includes('account review')) return 'ACCOUNT_REVIEW';
  if (status === 401 && (detail.includes('restricted to only send') || detail.includes('permission'))) return 'API_KEY_PERMISSION_RESTRICTED';
  if (status === 401) return 'API_KEY_REJECTED';
  if (detail.includes('only send testing emails') || detail.includes('testing email')) return 'TEST_RECIPIENT_RESTRICTED';
  if (detail.includes('verify a domain') || detail.includes('verified domain') || detail.includes('domain is not verified')) return 'SENDING_DOMAIN_UNVERIFIED';
  if (status === 403) return 'PROVIDER_ACCESS_RESTRICTED';
  if (status === 422 || detail.includes('invalid recipient') || detail.includes('invalid email')) return 'INVALID_RECIPIENT';
  if (detail.includes('sender') || detail.includes('from address')) return 'INVALID_SENDER';
  return 'PROVIDER_ERROR';
}

const userMessage = (category) => ({
  RATE_LIMITED: 'Resend temporarily rate limited this message. Wait before retrying.',
  ACCOUNT_SUSPENDED: 'Resend reports an account sending restriction. Email is temporarily unavailable; your account is saved and can be retried after the restriction is resolved.',
  ACCOUNT_REVIEW: 'Resend is reviewing the sending account. Email is temporarily unavailable; your account is saved and can be retried when sending is restored.',
  API_KEY_PERMISSION_RESTRICTED: 'The Resend API key does not have permission for this operation. Email is temporarily unavailable.',
  API_KEY_REJECTED: 'Resend rejected the server API key. Email is temporarily unavailable.',
  EMAIL_NOT_CONFIGURED: 'Email sending is not configured in this environment. Check the local admin email preview for the verification or reset link.',
  TEST_RECIPIENT_RESTRICTED: 'Resend’s testing sender only accepts its permitted test inbox. Verify a sending domain before sending to other addresses.',
  SENDING_DOMAIN_UNVERIFIED: 'Resend requires a verified sending domain before it can send to this address.',
  PROVIDER_ACCESS_RESTRICTED: 'Resend refused this send. Check the sending account and domain configuration before retrying.',
  INVALID_RECIPIENT: 'Resend rejected this recipient address. Check the address and try again.',
  INVALID_SENDER: 'Resend rejected the configured sender address. Check the sender and domain configuration.',
  PROVIDER_ERROR: 'Resend could not accept this email. It was not marked as delivered.',
  NETWORK_ERROR: 'Morgan could not confirm whether Resend accepted this email. Check the email log before retrying.',
}[category] || 'Email could not be accepted by the provider.');

async function record(db, entry) {
  if (!db) return;
  try {
    await db.collection('emailEvents').insertOne({
      _id: new Date().toISOString() + ':' + randomUUID(),
      kind: entry.kind || 'unspecified',
      recipientHash: entry.to ? createHash('sha256').update(entry.to.trim().toLowerCase()).digest('hex') : null,
      status: entry.status,
      providerStatus: entry.providerStatus ?? null,
      category: entry.category ?? null,
      providerMessage: entry.providerMessage ?? null,
      resendId: entry.resendId ?? null,
      createdAt: new Date(),
    });
  } catch {
    // A mail audit write must not change the authentication or notification outcome.
  }
}

export function listLocalEmailPreviews() {
  if (!localEmailPreviewEnabled()) return [];
  return previews.slice().reverse().map((item) => ({ ...item }));
}

const failure = (category, { providerStatus = null, providerMessage = null, status = 'rejected', httpStatus = 502 } = {}) =>
  Object.assign(new Error(userMessage(category)), {
    code: category, category, status: httpStatus, providerStatus,
    providerMessage: providerMessage ? redact(providerMessage) : null,
    deliveryStatus: status,
  retryable: category === 'RATE_LIMITED' || category === 'NETWORK_ERROR' || category === 'PROVIDER_ERROR',
  });

/** Send through Resend. `accepted` means the API accepted the request, not inbox delivery. */
export async function sendMail({ to, subject, text, html, replyTo, attachments = [], db, kind }) {
  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    const err = failure('INVALID_RECIPIENT', { status: 'failed', httpStatus: 400, providerMessage: 'Invalid email address.' });
    await record(db, { to, kind, status: 'failed', category: err.code, providerMessage: err.providerMessage });
    throw err;
  }

  const originalTo = to.trim();
  const useTestRecipient = isDevelopment() && process.env.MORGAN_EMAIL_TEST_OVERRIDE === '1'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.RESEND_TEST_TO || '');
  const actualTo = useTestRecipient ? process.env.RESEND_TEST_TO.trim() : originalTo;
  const actualSubject = useTestRecipient ? `[DEV TEST] ${subject}` : subject;
  const actualText = useTestRecipient
    ? `Development test copy. Intended recipient: ${originalTo}\n\n${text || ''}`
    : text;
  const id = randomUUID();
  if (localEmailPreviewEnabled() && ['verification', 'password_reset'].includes(kind)) {
    previews.push({ id, kind, to: actualTo, intendedRecipient: originalTo, subject: actualSubject, text: actualText || '', html: html || '', createdAt: new Date().toISOString() });
    if (previews.length > 100) previews.splice(0, previews.length - 100);
  }

  if (!mailConfigured()) {
    const err = failure('EMAIL_NOT_CONFIGURED', { status: 'failed', httpStatus: 503, providerMessage: 'Email sending is not configured.' });
    await record(db, { to: originalTo, kind, status: 'failed', category: err.code, providerMessage: err.providerMessage });
    throw err;
  }

  let result;
  try {
    result = await resendClient().emails.send({
      from: process.env.MAIL_FROM,
      to: [actualTo],
      subject: actualSubject,
      text: actualText,
      html,
      replyTo: replyTo || undefined,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
    });
  } catch (cause) {
    const err = failure('NETWORK_ERROR', { status: 'unknown', providerMessage: cause?.message || 'Network request failed.' });
    await record(db, { to: originalTo, kind, status: 'unknown', category: err.code, providerMessage: err.providerMessage });
    throw err;
  }

  const { data, error } = result || {};
  if (error) {
    const providerStatus = Number(error.statusCode) || null;
    if (providerStatus === null && error.name === 'application_error') {
      const err = failure('NETWORK_ERROR', { status: 'unknown', providerMessage: error.message });
      await record(db, { to: originalTo, kind, status: 'unknown', category: err.code, providerMessage: err.providerMessage });
      throw err;
    }
    const category = categorize(providerStatus, error.message);
    const err = failure(category, { providerStatus, providerMessage: error.message, httpStatus: providerStatus === 429 ? 503 : providerStatus === 422 ? 400 : 502 });
    await record(db, { to: originalTo, kind, status: 'rejected', providerStatus, category, providerMessage: err.providerMessage });
    throw err;
  }
  if (!data?.id) {
    const err = failure('NETWORK_ERROR', { status: 'unknown', providerMessage: 'Resend response did not include a message id.' });
    await record(db, { to: originalTo, kind, status: 'unknown', category: err.code, providerMessage: err.providerMessage });
    throw err;
  }
  await record(db, { to: originalTo, kind, status: 'accepted', resendId: data.id });
  return { id: data.id, status: 'accepted', ...(useTestRecipient && { testRecipient: true }) };
}

/** Non-blocking business action with an explicit provider outcome for the caller. */
export async function notifyMail(message) {
  try { return await sendMail(message); }
  catch (error) {
    return { status: error.deliveryStatus || 'failed', code: error.code || 'DELIVERY_FAILED', message: error.message };
  }
}
