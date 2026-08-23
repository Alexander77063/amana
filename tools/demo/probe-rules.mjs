// Prove the category lock and time window actually gate a spend end to end: publish rules as
// the principal, then attempt spends as the agent and check the engine's verdict.
import { call, idem, login, newBvn, newNin, newPhone } from './lib.mjs';

const pTok = (await login(newPhone(), { nin: newNin(), bvn: newBvn() })).body.accessToken;
const hh = await call('/households', {
  method: 'POST',
  token: pTok,
  body: { name: 'Rules Probe' },
});
const householdId = hh.body?.household?.id ?? hh.body?.id;
const masterWalletId = hh.body?.masterWallet?.id;

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
  body: { agentUserId: a.body.user.id, name: 'Rules probe wallet' },
});
const subWalletId = sw.body?.subWallet?.id;

/** Publish an active rule set, exactly as the editor screen does. */
async function publish(rules) {
  const r = await call(`/sub-wallets/${subWalletId}/rules`, {
    method: 'POST',
    token: pTok,
    body: { rules },
  });
  if (r.status !== 201) throw new Error(`publish failed: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Attempt a spend and return the engine's verdict. */
async function spend(category, amountKobo = '500000') {
  const intent = await call('/transactions/intent', {
    method: 'POST',
    token: aTok,
    body: {
      masterWalletId,
      subWalletId,
      amountKobo,
      idempotencyKey: idem('rules'),
      vendorBankCode: '058',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'ADEBAYO STORES LTD',
      category,
      agentNote: null,
    },
  });
  if (intent.status !== 201) return `intent ${intent.status}`;
  const ev = await call(`/transactions/${intent.body.transactionId}/evaluate`, {
    method: 'POST',
    token: aTok,
  });
  return ev.body?.kind ?? `evaluate ${ev.status}`;
}

const checks = [];
const expect = (label, actual, want) => {
  const ok = actual === want;
  checks.push(ok);
  console.log(
    `${ok ? '  ✓' : '  ✗'} ${label.padEnd(52)} → ${actual}${ok ? '' : `  (want ${want})`}`,
  );
};

console.log('\n── category allowlist: only transport + school ──');
await publish([
  { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } },
  {
    kind: 'category',
    priority: 20,
    config: { mode: 'allowlist', categories: ['transport', 'school'] },
  },
]);
expect('transport (on the allowlist)', await spend('transport'), 'allow');
expect('food (not on the allowlist)', await spend('food'), 'bump_pending');

console.log('\n── category blocklist: block airtime_data ──');
await publish([
  { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } },
  { kind: 'category', priority: 20, config: { mode: 'blocklist', categories: ['airtime_data'] } },
]);
expect('food (not blocked)', await spend('food'), 'allow');
expect('airtime_data (blocked)', await spend('airtime_data'), 'bump_pending');

console.log('\n── time window: a window that cannot contain now ──');
// Pick a one-hour window on the opposite side of the clock from the current Lagos hour, so
// this is deterministic whenever it runs.
const lagosHour =
  Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  ) % 24;
const farStart = (lagosHour + 6) % 24;
await publish([
  { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } },
  {
    kind: 'time_window',
    priority: 30,
    config: {
      startHour: farStart,
      endHour: (farStart + 1) % 24,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    },
  },
]);
console.log(`     (Lagos hour now ${lagosHour}; window ${farStart}–${(farStart + 1) % 24})`);
expect('spend outside the allowed hours', await spend('transport'), 'bump_pending');

console.log('\n── time window: a window that contains now ──');
await publish([
  { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } },
  {
    kind: 'time_window',
    priority: 30,
    config: { startHour: 0, endHour: 23, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
  },
]);
expect('spend inside the allowed hours', await spend('transport'), 'allow');

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
