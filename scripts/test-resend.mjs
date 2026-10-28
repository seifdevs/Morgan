import { sendMail } from '../server/lib/mail.mjs';

const recipient = process.env.RESEND_TEST_TO || 'seif.a7@icloud.com';
const origin = (process.env.APP_URL || 'http://localhost:4173').replace(/\/$/, '');
const cases = [
  ['Verification email', 'Morgan verification flow test', `This is a Resend integration check for the verification-email flow. Local test link: ${origin}/verify-email?token=sample-test-token`],
  ['Welcome email', 'Morgan welcome flow test', 'This is a Resend integration check for the welcome-email flow after email verification.'],
  ['Password reset', 'Morgan password reset flow test', `This is a Resend integration check for the reset-email flow. Local test link: ${origin}/reset-password?token=sample-test-token`],
  ['Security notification', 'Morgan account security test', 'This is a Resend integration check for account security notifications. No account settings were changed.'],
  ['Bank statement import confirmation', 'Morgan statement import test', 'This is a Resend integration check for statement-import confirmations. No bank statement was imported.'],
];

if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
  console.error('Resend test could not run: RESEND_API_KEY and MAIL_FROM must be configured in the server environment.');
  process.exit(1);
}

let failed = false;
for (const [name, subject, text] of cases) {
  try {
    const result = await sendMail({ to: recipient, subject, text });
    console.log(JSON.stringify({ test: name, recipient, request: 'accepted', resendEmailId: result.id, apiError: null, deliveryStatus: 'unknown' }));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ test: name, recipient, request: 'failed', resendEmailId: null, apiError: { code: error.code || 'DELIVERY_FAILED', status: error.status || null, message: error.message }, deliveryStatus: 'unknown' }));
  }
}
if (failed) process.exitCode = 1;
