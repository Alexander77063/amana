// Probe: what does resume-after-bump do with a token that does not exist?
import { call, login, newNin, newPhone } from './lib.mjs';

const a = await login(newPhone(), { nin: newNin(), pairingCode: undefined, bvn: '12345678901' });
const token = a.body.accessToken;

const good = '00000000-0000-0000-0000-000000000000';
for (const [label, path, body] of [
  [
    'unknown one-shot token',
    `/transactions/${good}/resume-after-bump`,
    { token: 'does-not-exist' },
  ],
  ['empty token', `/transactions/${good}/resume-after-bump`, { token: '' }],
  ['malformed txn id', '/transactions/not-a-uuid/resume-after-bump', { token: 'does-not-exist' }],
]) {
  const r = await call(path, { method: 'POST', token, body });
  console.log(`${label.padEnd(26)} → ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
}
