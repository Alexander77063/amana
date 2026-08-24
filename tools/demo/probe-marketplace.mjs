// Does a category lock actually gate a MARKETPLACE purchase?
//
// The parent locks spending to transport and school. The agent then buys a voucher for a salon
// service — a category the parent never allowed. If that succeeds, the category lock is a hole:
// the parent believes they have restricted what their agent can buy, and the entire catalogue
// walks straight past it.
//
// Same shape as probe-vas.mjs, which proved the identical bypass on the VAS path.
import { call, idem, login, newBvn, newNin, newPhone } from './lib.mjs';

const ADMIN = process.env.ADMIN_API_KEY ?? 'demo-admin-key-000000000000000000';
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3100';

const pTok = (await login(newPhone(), { nin: newNin(), bvn: newBvn() })).body.accessToken;
const hh = await call('/households', {
  method: 'POST',
  token: pTok,
  body: { name: 'Marketplace Probe' },
});
const householdId = hh.body?.household?.id ?? hh.body?.id;

await fetch('http://localhost:3200/_control/fund', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amountKobo: '50000000' }),
});

const pair = await call('/pairing', { method: 'POST', token: pTok, body: { householdId } });
const a = await login(newPhone(), { nin: newNin(), pairingCode: pair.body.code });
const aTok = a.body.accessToken;

const sw = await call(`/households/${householdId}/sub-wallets`, {
  method: 'POST',
  token: pTok,
  body: { agentUserId: a.body.user.id, name: 'Marketplace probe wallet' },
});
const subWalletId = sw.body?.subWallet?.id;

// The parent locks spending to transport and school. A salon is deliberately NOT on the list.
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

// An approved retailer with one item, created the way ops would.
const adminJson = async (path, body) => {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-api-key': ADMIN },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
};
const retailer = await adminJson('/retailers', {
  businessName: 'Ada Salon',
  payoutBankCode: '000014',
  payoutAccountNumber: '0123456789',
});
const retailerId = retailer.body?.retailer?.id ?? retailer.body?.id;
await adminJson(`/retailers/${retailerId}/approve`, {});

// The catalogue item lives in a section the parent's allowlist does not contain.
const { spawnSync } = await import('node:child_process');
const itemId = crypto.randomUUID();
const insert = spawnSync(
  'docker',
  [
    'exec',
    'amana-postgres',
    'psql',
    '-U',
    'amana',
    '-d',
    'amana_dev',
    '-c',
    `insert into catalog_items (id, retailer_id, name, price_kobo, section, category, status)
     values ('${itemId}', '${retailerId}', 'Wash and set', 300000, 'hair', 'health', 'active')`,
  ],
  { encoding: 'utf8' },
);
if (insert.status !== 0) {
  console.log('could not seed the catalogue item:', insert.stderr?.slice(0, 300));
  process.exit(2);
}
console.log('catalogue item : Wash and set, category "health", ₦3,000');

// A normal bank transfer tagged with that same category is correctly held for approval.
const intent = await call('/transactions/intent', {
  method: 'POST',
  token: aTok,
  body: {
    masterWalletId: hh.body?.masterWallet?.id,
    subWalletId,
    amountKobo: '300000',
    idempotencyKey: idem('mktprobe'),
    vendorBankCode: '058',
    vendorAccountNumber: '0123456789',
    vendorResolvedName: 'ADA SALON',
    category: 'health',
    agentNote: null,
  },
});
const ev = await call(`/transactions/${intent.body.transactionId}/evaluate`, {
  method: 'POST',
  token: aTok,
});
console.log(`bank transfer tagged health     → ${ev.body?.kind}`);

// Now the same spend, as a marketplace purchase.
const buy = await call('/marketplace/purchase', {
  method: 'POST',
  token: aTok,
  body: { subWalletId, catalogItemId: itemId, idempotencyKey: idem('mktbuy') },
});
console.log(
  `marketplace purchase            → ${buy.status} ${JSON.stringify(buy.body).slice(0, 150)}`,
);

const bypassed = buy.status === 201;
console.log(
  bypassed
    ? '\n✗ HOLE: the category lock did not apply to the marketplace — the voucher was sold anyway.'
    : '\n✓ the category lock applied to the marketplace purchase.',
);
process.exit(bypassed ? 1 : 0);
