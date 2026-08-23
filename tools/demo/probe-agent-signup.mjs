// Probe: can a brand-new agent onboard through the agent app's exact request shape?
// The agent app sends only { phone, code } — no nin, no bvn, no pairingCode.
import { call, newPhone } from './lib.mjs';

const phone = newPhone();
await call('/auth/otp/request', { method: 'POST', body: { phone, purpose: 'login' } });

// Exactly what apps/agent VerifyScreen sends.
const r = await call('/auth/otp/verify', { method: 'POST', body: { phone, code: '123456' } });
console.log(`agent-app shape  { phone, code }        → ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

// For contrast: with a pairing code (what the API actually needs to mint an agent).
const phone2 = newPhone();
await call('/auth/otp/request', { method: 'POST', body: { phone: phone2, purpose: 'pair' } });
const r2 = await call('/auth/otp/verify', {
  method: 'POST',
  body: { phone: phone2, code: '123456', pairingCode: 'bogus-code', nin: '22222222222' },
});
console.log(`with pairingCode { …, pairingCode, nin } → ${r2.status} ${JSON.stringify(r2.body).slice(0, 160)}`);
