// Email delivery via Resend's HTTP API, only when RESEND_API_KEY and MAIL_FROM are configured.
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail({ to, subject, text, replyTo, attachments = [] }) {
  if (!mailConfigured()) throw Object.assign(new Error('Email delivery is not configured'), { status: 503 });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM, to: [to], subject, text, reply_to: replyTo || undefined,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Email provider rejected the message (${res.status})`), { status: 502, detail });
  }
  return res.json();
}
