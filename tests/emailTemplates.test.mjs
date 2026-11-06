import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationEmail } from '../server/lib/emailTemplates.mjs';

test('verification email is branded, segmented, escaped, and provides a link fallback', () => {
  const message = verificationEmail({ name: '<Morgan & Co>', code: '004281', link: 'https://morgan.example/verify-email?token=sample' });
  assert.equal(message.subject, 'Your Morgan verification code');
  assert.match(message.text, /0\s+0\s+4\s+2\s+8\s+1/);
  assert.match(message.text, /https:\/\/morgan\.example\/verify-email/);
  assert.match(message.html, /&lt;Morgan &amp; Co&gt;/);
  assert.doesNotMatch(message.html, /<Morgan & Co>/);
  assert.equal((message.html.match(/height="56"/g) || []).length, 6);
  assert.match(message.html, /href="https:\/\/morgan\.example\/verify-email\?token=sample"/);
});
