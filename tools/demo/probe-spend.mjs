// Reproduce the agent's spend exactly as the app does it, and print each API response,
// so a "Payment failed / Error: UNKNOWN" in the UI can be traced to a real status code.
import { call, idem, login, newBvn, newNin, newPhone } from './lib.mjs';

const pPhone = newPhone();
const p = await login(pPhone, { nin: newNin(), bvn: newBvn() });
const pTok = p.body.accessToken;

const hh = await call('/households', {
  method: 'POST',
  token: pTok,
  body: { name: 'Probe Household' },
});
const householdId = hh.body?.household?.id ?? hh.body?.id;
const masterWalletId = hh.body?.masterWallet?.id;
console.log(`household ${householdId} master ${masterWalletId}`);

await fetch('http://localhost:3200/_control/fund', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amountKobo: '50000000' }),
});

const pair = await call('/pairing', { method: 'POST', token: pTok, body: { householdId } });
const aPhone = newPhone();
const a = await login(aPhone, { nin: newNin(), pairingCode: pair.body.code });
const aTok = a.body.accessToken;
const agentId = a.body.user.id;

const sw = await call(`/households/${householdId}/sub-wallets`, {
  method: 'POST',
  token: pTok,
  body: { agentUserId: agentId, name: 'Probe wallet' },
});
const subWalletId = sw.body?.subWallet?.id;
console.log(`sub-wallet ${subWalletId}`);

await call(`/sub-wallets/${subWalletId}/rules`, {
  method: 'POST',
  token: pTok,
  body: {
    rules: [{ kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } }],
  },
});

const ref = idem('probe');
const intent = await call('/transactions/intent', {
  method: 'POST',
  token: aTok,
  body: {
    masterWalletId,
    subWalletId,
    amountKobo: '750000',
    idempotencyKey: ref,
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'ADEBAYO STORES LTD',
    category: null,
    agentNote: null,
  },
});
console.log(`intent   → ${intent.status} ${JSON.stringify(intent.body).slice(0, 200)}`);
const txnId = intent.body?.transactionId;

const ev = await call(`/transactions/${txnId}/evaluate`, { method: 'POST', token: aTok });
console.log(`evaluate → ${ev.status} ${JSON.stringify(ev.body).slice(0, 200)}`);

const send = await call(`/transactions/${txnId}/send`, { method: 'POST', token: aTok });
console.log(`send     → ${send.status} ${JSON.stringify(send.body).slice(0, 300)}`);
