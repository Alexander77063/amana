// Does a category lock actually gate a VAS purchase?
//
// The parent locks spending to transport/school only. The agent then buys airtime for their
// own phone. If that succeeds, the category lock is a hole: the parent believes they have
// restricted spending, and airtime, data, electricity and cable all walk straight past it.
import { call, idem, login, newBvn, newNin, newPhone } from './lib.mjs';

const pTok = (await login(newPhone(), { nin: newNin(), bvn: newBvn() })).body.accessToken;
const hh = await call('/households', { method: 'POST', token: pTok, body: { name: 'VAS Probe' } });
const householdId = hh.body?.household?.id ?? hh.body?.id;
const masterWalletId = hh.body?.masterWallet?.id;

await fetch('http://localhost:3200/_control/fund', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amountKobo: '50000000' }),
});

const pair = await call('/pairing', { method: 'POST', token: pTok, body: { householdId } });
const agentPhone = newPhone();
const a = await login(agentPhone, { nin: newNin(), pairingCode: pair.body.code });
const aTok = a.body.accessToken;

const sw = await call(`/households/${householdId}/sub-wallets`, {
  method: 'POST',
  token: pTok,
  body: { agentUserId: a.body.user.id, name: 'VAS probe wallet' },
});
const subWalletId = sw.body?.subWallet?.id;

// The parent locks spending to transport and school. Airtime is deliberately NOT allowed.
await call(`/sub-wallets/${subWalletId}/rules`, {
  method: 'POST',
  token: pTok,
  body: {
    rules: [
      { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '5000000' } },
      {
        kind: 'category',
        priority: 20,
        config: { mode: 'allowlist', categories: ['transport', 'school'] },
      },
    ],
  },
});
console.log('parent locked spending to: transport, school');

// A normal spend outside that list is correctly held for approval.
const intent = await call('/transactions/intent', {
  method: 'POST',
  token: aTok,
  body: {
    masterWalletId,
    subWalletId,
    amountKobo: '300000',
    idempotencyKey: idem('vasprobe'),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'SHOP',
    category: 'airtime_data',
    agentNote: null,
  },
});
const ev = await call(`/transactions/${intent.body.transactionId}/evaluate`, {
  method: 'POST',
  token: aTok,
});
console.log(`bank transfer tagged airtime_data → ${ev.body?.kind}`);

// Now the same money, spent as airtime, to the agent's own phone.
const vas = await call('/vas/purchase', {
  method: 'POST',
  token: aTok,
  body: {
    subWalletId,
    category: 'airtime',
    provider: 'mtn',
    productSlug: 'topup',
    recipient: agentPhone,
    amountKobo: '300000',
    idempotencyKey: idem('vas'),
  },
});
console.log(`VAS airtime purchase          → ${vas.status} ${JSON.stringify(vas.body).slice(0, 160)}`);

const bypassed = vas.status === 201;
console.log(
  bypassed
    ? '\n✗ HOLE: the category lock did not apply to VAS — airtime went through anyway.'
    : '\n✓ the category lock applied to VAS.',
);
process.exit(bypassed ? 1 : 0);
