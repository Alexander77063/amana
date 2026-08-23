// Amana demo driver — walks the real product end to end against a running backend.
//
// Doubles as (a) the seeder for the app-footage demo, (b) the "engine" segment of the
// investor video for features that have no UI yet, and (c) an integration smoke test that
// catches breakage the unit suite cannot (wrong wiring, dead-end flows, bad status codes).
//
// Prereqs: backend on :3100 with ANCHOR_API_BASE_URL pointed at the stub on :3200.
//
//   node tools/demo/drive.mjs

import {
  bad,
  call,
  idem,
  login,
  naira,
  newBvn,
  newNin,
  newPhone,
  note,
  ok,
  phase,
  step,
  stub,
  summary,
} from './lib.mjs';

const world = {};

// ── 1. Principal signs up ──────────────────────────────────────────────────
phase('1. Principal onboarding');

const principalPhone = newPhone();
const p = await login(principalPhone, { nin: newNin(), bvn: newBvn() });
if (p.status === 200 && p.body.accessToken) {
  world.principalToken = p.body.accessToken;
  world.principalId = p.body.user.id;
  ok('Principal signs up with phone OTP', `${principalPhone} → ${p.body.user.role}`);
} else {
  bad('Principal signs up with phone OTP', `${p.status} ${JSON.stringify(p.body).slice(0, 160)}`);
  process.exit(summary());
}

await step('Principal session resolves', '/me', { token: world.principalToken });

// ── 2. Household + master wallet (real Anchor calls) ───────────────────────
phase('2. Household + master wallet');

const hh = await step(
  'Create household (Anchor customer + virtual account)',
  '/households',
  {
    method: 'POST',
    token: world.principalToken,
    body: { name: 'Adebayo Family' },
  },
  [201, 200],
);

world.householdId = hh?.household?.id ?? hh?.id;
world.masterWalletId = hh?.masterWallet?.id ?? hh?.wallet?.id;
const va = hh?.masterWallet ?? hh?.wallet ?? {};
note(`household=${world.householdId} master=${world.masterWalletId}`);
note(`fundable NUBAN: ${va.anchorBankCode ?? '?'} / ${va.anchorVirtualAccount ?? '?'}`);

const meHh = await step('Principal reads their household', '/me/household', {
  token: world.principalToken,
});
world.householdId ??= meHh?.household?.id;
world.masterWalletId ??= meHh?.masterWallet?.id;

// ── 3. Fund the wallet (inbound bank transfer → webhook → ledger) ──────────
phase('3. Funding the wallet');

const fund = await stub('/_control/fund', { amountKobo: '50000000' });
if (fund.status === 200 && fund.body?.status === 200) {
  ok('Bank credit arrives as a signed webhook', `${naira('50000000')} → virtual_account.credited`);
} else {
  bad('Bank credit arrives as a signed webhook', JSON.stringify(fund.body).slice(0, 200));
}

const bal = await step('Master wallet balance reflects the credit', '/me/household', {
  token: world.principalToken,
});
note(`balance payload: ${JSON.stringify(bal?.balance ?? bal?.masterWallet ?? {}).slice(0, 200)}`);

// ── 4. Pair an agent ───────────────────────────────────────────────────────
phase('4. Phone-to-phone pairing');

const pair = await step(
  'Principal issues a pairing code',
  '/pairing',
  {
    method: 'POST',
    token: world.principalToken,
    body: { householdId: world.householdId },
  },
  [200, 201],
);
world.pairingCode = pair?.code ?? pair?.token ?? pair?.pairingCode;
note(`pairing code: ${world.pairingCode}`);

const agentPhone = newPhone();
const a = await login(agentPhone, { nin: newNin(), pairingCode: world.pairingCode });
if (a.status === 200 && a.body.accessToken) {
  world.agentToken = a.body.accessToken;
  world.agentId = a.body.user.id;
  ok('Agent signs up and pairs in one step', `${agentPhone} → ${a.body.user.role}`);
} else {
  bad('Agent signs up and pairs', `${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
}

await step('Household now lists the agent as a member', '/me/household/members', {
  token: world.principalToken,
});

// ── 5. Sub-wallet + spending rules ─────────────────────────────────────────
phase('5. Sub-wallet with real-time controls');

const sw = await step(
  'Principal issues a sub-wallet to the agent',
  `/households/${world.householdId}/sub-wallets`,
  {
    method: 'POST',
    token: world.principalToken,
    body: { agentUserId: world.agentId, name: 'Tunde — school run' },
  },
  [201],
);
world.subWalletId = sw?.subWallet?.id;
note(`sub-wallet: ${world.subWalletId}`);

await step(
  'Principal sets a daily limit + category lock',
  `/sub-wallets/${world.subWalletId}/rules`,
  {
    method: 'POST',
    token: world.principalToken,
    body: {
      rules: [
        { kind: 'limit', priority: 10, config: { windowKind: 'daily', maxKobo: '2000000' } },
        {
          kind: 'category',
          priority: 20,
          config: { mode: 'allowlist', categories: ['transport', 'food', 'school'] },
        },
      ],
    },
  },
  [201],
);

await step('Rules read back as the active version', `/sub-wallets/${world.subWalletId}/rules`, {
  token: world.principalToken,
});

// ── 6. A within-limit spend ────────────────────────────────────────────────
phase('6. Agent spends within limits');

const intent = await step(
  'Agent creates a spend intent',
  '/transactions/intent',
  {
    method: 'POST',
    token: world.agentToken,
    body: {
      masterWalletId: world.masterWalletId,
      subWalletId: world.subWalletId,
      amountKobo: '750000',
      idempotencyKey: idem('spend'),
      vendorBankCode: '000014',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'ADEBAYO STORES LTD',
      category: 'transport',
      agentNote: 'Bus fare + lunch',
    },
  },
  [201],
);
world.txnId = intent?.transactionId;
note(`txn ${world.txnId} — ${naira('750000')} to ADEBAYO STORES LTD`);

const evalRes = await call(`/transactions/${world.txnId}/evaluate`, {
  method: 'POST',
  token: world.agentToken,
});
if (evalRes.status === 200 && evalRes.body?.kind === 'allow') {
  ok('Rules engine allows it', `within ${naira('2000000')} daily limit`);
} else {
  bad('Rules engine allows it', `${evalRes.status} ${JSON.stringify(evalRes.body).slice(0, 200)}`);
}

const sendRes = await call(`/transactions/${world.txnId}/send`, {
  method: 'POST',
  token: world.agentToken,
});
if (sendRes.status === 202) {
  ok('Payout sent to the bank rail', `status ${JSON.stringify(sendRes.body).slice(0, 120)}`);
} else {
  bad(
    'Payout sent to the bank rail',
    `${sendRes.status} ${JSON.stringify(sendRes.body).slice(0, 200)}`,
  );
}

const settle = await stub('/_control/settle', {});
if (settle.status === 200 && settle.body?.status === 200) {
  ok('Bank confirms — transfer.completed webhook settles the ledger');
} else {
  bad('Bank confirms settlement', JSON.stringify(settle.body).slice(0, 200));
}

await step('Agent sees the settled receipt', `/transactions/${world.txnId}`, {
  token: world.agentToken,
});

// ── 7. Over-limit spend → bump → approval ──────────────────────────────────
phase('7. Over-limit spend needs the principal (bump)');

const bigIntent = await step(
  'Agent tries a spend over the daily limit',
  '/transactions/intent',
  {
    method: 'POST',
    token: world.agentToken,
    body: {
      masterWalletId: world.masterWalletId,
      subWalletId: world.subWalletId,
      amountKobo: '1800000',
      idempotencyKey: idem('bump'),
      vendorBankCode: '000014',
      vendorAccountNumber: '0123456789',
      vendorResolvedName: 'ADEBAYO STORES LTD',
      category: 'school',
      agentNote: 'School books',
    },
  },
  [201],
);
world.bumpTxnId = bigIntent?.transactionId;

const bumpEval = await call(`/transactions/${world.bumpTxnId}/evaluate`, {
  method: 'POST',
  token: world.agentToken,
});
if (bumpEval.status === 202 && bumpEval.body?.kind === 'bump_pending') {
  world.bumpId = bumpEval.body.bumpRequestId;
  ok('Rules engine holds it for approval', `bump ${world.bumpId}`);
} else {
  bad(
    'Rules engine holds it for approval',
    `${bumpEval.status} ${JSON.stringify(bumpEval.body).slice(0, 200)}`,
  );
}

await step("Principal's bump inbox shows the request", '/me/bumps', {
  token: world.principalToken,
});

if (world.bumpId) {
  const decision = await call(`/bumps/${world.bumpId}/decision`, {
    method: 'POST',
    token: world.principalToken,
    body: { decision: 'approve_once' },
  });
  if ([200, 201].includes(decision.status)) {
    world.resumeToken = decision.body?.oneShotToken;
    if (world.resumeToken) {
      ok(
        'Principal approves from their phone',
        `one-shot token ${String(world.resumeToken).slice(0, 12)}…`,
      );
    } else {
      bad(
        'Principal approves from their phone',
        `approved but no oneShotToken: ${JSON.stringify(decision.body)}`,
      );
    }
  } else {
    bad(
      'Principal approves the bump',
      `${decision.status} ${JSON.stringify(decision.body).slice(0, 200)}`,
    );
  }
}

if (world.resumeToken) {
  const resumed = await call(`/transactions/${world.bumpTxnId}/resume-after-bump`, {
    method: 'POST',
    token: world.agentToken,
    body: { token: world.resumeToken },
  });
  if (resumed.status === 200) {
    ok('Agent resumes the spend', `status ${resumed.body?.status}`);
  } else {
    bad(
      'Agent resumes the spend',
      `${resumed.status} ${JSON.stringify(resumed.body).slice(0, 200)}`,
    );
  }
}

console.log('');
note(JSON.stringify(world, null, 2));
process.exit(summary());
