import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv } from '../server/index.mjs';

test('environment validation reports problems without echoing secrets', () => {
  assert.deepEqual(checkEnv({}, { uri: 'mongodb+srv://u:p@cluster0.example.mongodb.net/' }), []);
  const p = checkEnv({ PORT: 'abc', RESEND_API_KEY: 're_secret', TRUST_PROXY: 'yes', MONGODB_DB: 'bad name' }, { uri: 'postgres://u:hunter2@h' });
  assert.equal(p.length, 5);
  assert.ok(!p.join(' ').includes('hunter2') && !p.join(' ').includes('re_secret'));
  assert.match(checkEnv({}, { uri: '' })[0], /MONGODB_URI is not set/);
});
