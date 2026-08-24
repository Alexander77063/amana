// Records the Amana product walkthrough as a single 1080p video showing both phones
// side by side, driven through the real UI in a browser.
//
//   node tools/demo/record.mjs          # full pacing
//   SPEED=3 node tools/demo/record.mjs  # fast, for iterating on the script
//
// Prereqs (see tools/demo/README.md): backend :3100 (CORS allowlisted, pointed at the
// Anchor stub), stub :3200, principal web :19006, agent web :19007.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const STAGE_PORT = Number(process.env.STAGE_PORT ?? 19100);
const PRINCIPAL = process.env.PRINCIPAL_URL ?? 'http://localhost:19006';
const AGENT = process.env.AGENT_URL ?? 'http://localhost:19007';
const STUB = process.env.STUB_URL ?? 'http://localhost:3200';
const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const SPEED = Number(process.env.SPEED ?? 1);

mkdirSync(`${OUT}/video`, { recursive: true });

const stageServer = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const file = join('tools/demo', path === '/' ? 'stage.html' : path.replace(/^\//, ''));
  try {
    res.writeHead(200, {
      'content-type': extname(file) === '.html' ? 'text/html' : 'application/octet-stream',
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => stageServer.listen(STAGE_PORT, r));

const tag = String(Date.now()).slice(-7);
const PRINCIPAL_PHONE = `+2348${tag}01`;
const AGENT_PHONE = `+2348${tag}02`;
const NIN_P = String(22222222222n + BigInt(tag)).slice(-11);
const BVN_P = String(33333333333n + BigInt(tag)).slice(-11);
const NIN_A = String(44444444444n + BigInt(tag)).slice(-11);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: `${OUT}/video`, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
// Playwright starts recording when the page is created, so this is the video's t=0.
const t0 = Date.now();
const timings = [];

const failures = [];
const wait = (ms) => page.waitForTimeout(Math.round(ms / SPEED));

// Narration clip lengths, if `narrate.mjs --clips` has been run. The video is paced by the
// audio: a chapter is held until its line has finished, otherwise long lines talk over the
// next chapter. Skipped when SPEED > 1, which is for iterating on the script, not for a take.
const VO = existsSync(`${OUT}/vo-durations.json`)
  ? JSON.parse(readFileSync(`${OUT}/vo-durations.json`, 'utf8'))
  : {};
let lastBeatAt = 0;
let lastBeatMs = 0;

async function holdForNarration() {
  if (SPEED > 1) return;
  const until = lastBeatAt + lastBeatMs + 900;
  const now = Date.now();
  if (now < until) await page.waitForTimeout(until - now);
}

function markBeat(chapter, text, sub) {
  timings.push({ atMs: Date.now() - t0, chapter, text, sub });
  lastBeatAt = Date.now();
  lastBeatMs = VO[text] ?? 0;
}

async function cap(chapter, text, sub = '') {
  await holdForNarration();
  await page.evaluate(([c, t, s]) => window.stage.caption(c, t, s), [chapter, text, sub]);
  markBeat(chapter, text, sub);
  console.log(`  [${chapter}] ${text}`);
}

/** A full-bleed statement slide in the intro, before the phones appear. */
async function slide(kicker, title, body) {
  await holdForNarration();
  await page.evaluate(([k, t, b]) => window.stage.slide(k, t, b), [kicker, title, body]);
  markBeat(kicker, title, '');
  console.log(`  [${kicker}] ${title}`);
}
const focus = (which) => page.evaluate((w) => window.stage.focus(w), which);
const P = () => page.frameLocator('#principal');
const A = () => page.frameLocator('#agent');

/**
 * Re-navigate one of the phone frames and wait for the app to be ready.
 *
 * Assigning `iframe.src` from page script leaves Playwright briefly resolving the outgoing
 * document, so a locator can report "visible" and then time out on click. Driving the Frame
 * handle directly makes the navigation something Playwright tracks.
 */
async function reboot(which, url, ready) {
  const frameEl = await page.$(`#${which}`);
  const frame = await frameEl.contentFrame();
  await frame.goto(url, { waitUntil: 'load', timeout: 120_000 });
  const live = await (await page.$(`#${which}`)).contentFrame();
  await live.waitForFunction(
    () => (document.querySelector('#root')?.textContent ?? '').trim().length > 0,
    { timeout: 120_000 },
  );
  await ready(live).first().waitFor({ state: 'visible', timeout: 60_000 });
  return live;
}

async function step(label, fn) {
  try {
    await fn();
    console.log(`     ✓ ${label}`);
  } catch (e) {
    failures.push(`${label}: ${e.message.split('\n')[0]}`);
    console.log(`     ✗ ${label}: ${e.message.split('\n').slice(0, 12).join('\n        ')}`);
    await page.screenshot({ path: `${OUT}/record-FAIL-${failures.length}.png` }).catch(() => {});
  }
}

const stub = (path, body) =>
  fetch(`${STUB}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

/**
 * Settle a specific transfer, waiting for it to exist first.
 *
 * The app reaches the bank a beat after the screen changes — on the bump path the agent's
 * wait screen has to notice the approval, navigate, and only then initiate the transfer — so
 * firing settlement the instant we click is a race the stub loses with `no_such_transfer`.
 */
async function settleWhenReady(reference, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const r = await stub('/_control/settle', { reference });
    if (!r?.error) return r;
    await page.waitForTimeout(1500);
  }
  throw new Error(`transfer ${reference} never reached the bank`);
}

// The pairing code is displayed on the principal's screen; we also capture it off the wire
// so the script can drive the agent's deep link deterministically.
let spendReference = null;
page.on('request', (req) => {
  if (req.url().endsWith('/transactions/intent') && req.method() === 'POST') {
    try {
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.idempotencyKey) spendReference = body.idempotencyKey;
    } catch {
      /* ignore */
    }
  }
});

let pairingCode = null;
page.on('response', async (res) => {
  if (res.url().endsWith('/pairing') && res.request().method() === 'POST') {
    try {
      const b = await res.json();
      if (b?.code) pairingCode = b.code;
    } catch {
      /* ignore */
    }
  }
});

await page.goto(
  `http://localhost:${STAGE_PORT}/?principal=${encodeURIComponent(PRINCIPAL)}&agent=${encodeURIComponent(AGENT)}`,
  { waitUntil: 'load', timeout: 120_000 },
);
for (const f of [P(), A()]) {
  await f.locator('#root').first().waitFor({ state: 'attached', timeout: 180_000 });
}
await wait(4000);

// ── Intro: problem → gap → why now → solution → benefit ────────────────────
// Positioning is taken from docs/business/2026-05-03-business-plan.md rather than invented.
// Deliberately no financial projections: forecasts belong in the deck, not in a demo video.

await slide('The problem', 'Every Nigerian household has this conversation.', [
  { quote: '“What did you do with the ₦15,000 I gave you yesterday?”' },
  {
    p: 'Parents, spouses and business owners hand cash or open bank transfers to the people who spend on their behalf — children, domestic staff, drivers, kitchen staff, dispatch riders.',
  },
]);
await wait(1000);

await slide('Why it persists', 'Every existing option gives the money away completely.', [
  {
    bullets: [
      'Cash — no control, no record, and an argument at the end of it.',
      'Debit card — a PIN is not a rule.',
      'Bank transfer — instant, and instantly out of your hands.',
      'WhatsApp and screenshots — reconciliation by memory.',
    ],
  },
]);
await wait(1000);

await slide('The gap', 'The big wallets all sell the same wallet to everyone.', [
  {
    p: 'OPay, PalmPay, Moniepoint and Kuda are built on a single-user thesis. The banks are locked to one customer, one account. Nobody has segmented around delegated control — a daily, multi-billion-naira behaviour with no product built for it.',
  },
]);
await wait(1000);

await slide('Why now', 'The infrastructure that made this impossible is now standard.', [
  {
    bullets: [
      'Instant NIP transfer reaches almost every bank account in Nigeria.',
      'NIN enrolment covers most of the adult population.',
      'Banking-as-a-service turned a two-year build into a few months.',
    ],
  },
]);
await wait(1000);

await slide('The solution', 'Delegated authority, not delegated access.', [
  {
    bullets: [
      'One funded master wallet.',
      'A sub-wallet per person — a spending envelope, not another bank account.',
      'Limits, category locks and time windows, enforced on every single spend.',
      'A one-tap request when someone needs an exception — and instant suspend when they do not.',
    ],
  },
]);
await wait(1000);

await slide('The benefit', 'Control without the conversation.', [
  {
    bullets: [
      'The parent stops policing and starts setting rules.',
      'The agent stops justifying every naira.',
      'Every spend is auditable the moment it happens.',
      'Vendors need no app — they are paid over ordinary bank rails.',
    ],
  },
]);
await wait(1200);

await page.evaluate(() => window.stage.showPhones());
await cap(
  'Amana',
  'A parent funds one wallet. Every agent spends under their own limits.',
  'Recorded end to end through the real app against a live API. Nothing here is a mockup.',
);
await wait(3000);

// ── 1. Sign up ─────────────────────────────────────────────────────────────
await focus('principal');
await cap(
  '1 · Sign up',
  'The principal signs in with a phone number.',
  'One-time SMS code — no passwords anywhere in the product.',
);
await step('principal phone', async () => {
  await P().getByLabel('MOBILE NUMBER').fill(PRINCIPAL_PHONE);
  await wait(900);
  await P()
    .getByRole('button', { name: /SEND CODE/i })
    .click();
});
await wait(2600);

await cap(
  '1 · Sign up',
  'First-time signup also captures NIN and BVN.',
  'Nigerian identity numbers — required before the wallet can hold money.',
);
await step('principal verify', async () => {
  await P().getByLabel('6-DIGIT CODE').fill('123456');
  await wait(600);
  await P().getByLabel('NIN').fill(NIN_P);
  await P().getByLabel('BVN').fill(BVN_P);
  await wait(900);
  await P()
    .getByRole('button', { name: /^VERIFY/i })
    .first()
    .click();
});
await wait(4200);

// ── 2. Household + master wallet ───────────────────────────────────────────
await cap(
  '2 · The wallet',
  'Creating the household provisions a real bank account.',
  'A customer record and a fundable NUBAN at the banking partner.',
);
await step('create household', async () => {
  await P().getByLabel('HOUSEHOLD NAME').fill('Adebayo Family');
  await wait(900);
  await P()
    .getByRole('button', { name: /CREATE HOUSEHOLD/i })
    .click();
});
await wait(5200);

// ── 3. Funding ─────────────────────────────────────────────────────────────
await cap(
  '3 · Funding',
  'Money arrives by bank transfer into that account.',
  'The credit lands as a signed webhook and posts to a double-entry ledger.',
);
await step('fund wallet', async () => {
  await stub('/_control/fund', { amountKobo: '50000000' });
});
await wait(3000);

// ── 4. Pairing ─────────────────────────────────────────────────────────────
await cap(
  '4 · Pairing',
  'The principal issues a one-time pairing code.',
  'Phone to phone: scan the QR, tap NFC on Android, or send the link by SMS.',
);
await step('open pairing', async () => {
  await P()
    .getByRole('button', { name: /Pair an agent/i })
    .click();
  await wait(1500);
  await P()
    .getByRole('button', { name: /GENERATE CODE/i })
    .click();
});
await wait(4000);

await focus('agent');
await cap(
  '4 · Pairing',
  'The agent signs in on their own phone.',
  'A separate device and a separate login — the agent never sees the master wallet.',
);
await step('agent phone', async () => {
  await A().getByLabel('MOBILE NUMBER').fill(AGENT_PHONE);
  await wait(900);
  await A()
    .getByRole('button', { name: /SEND CODE/i })
    .click();
});
await wait(2600);

await cap(
  '4 · Pairing',
  'The agent types the code showing on the parent’s phone.',
  'That code is what binds this device to that household — nothing else will.',
);
await step('agent verify + pair', async () => {
  if (!pairingCode) throw new Error('pairing code never captured from POST /pairing');
  await A().getByLabel('VERIFICATION CODE').fill('123456');
  await wait(700);
  await A().getByLabel('PAIRING CODE').fill(pairingCode);
  await wait(700);
  await A().getByLabel('NIN').fill(NIN_A);
  await wait(900);
  await A()
    .getByRole('button', { name: /^VERIFY/i })
    .first()
    .click();
});
await wait(6000);

// ── 5. Sub-wallet ──────────────────────────────────────────────────────────
await focus('principal');
await cap(
  '5 · Sub-wallet',
  'The principal issues a sub-wallet to that agent.',
  'Not a bank account — a spending envelope drawn against the master wallet.',
);
// The principal has no visible back affordance (MainStack sets headerShown:false, so on a
// real phone this is the OS back gesture). Reloading the frame is the browser equivalent.
// Retried once: under concurrent two-app load this occasionally boots into the app's
// ErrorBoundary ("Maximum update depth exceeded") — see README "Known issues".
let pf = null;
await step('principal returns home', async () => {
  // No visible back affordance on the Pairing screen (MainStack sets headerShown:false — on a
  // real phone this is the OS back gesture), so the browser equivalent is a re-navigation.
  pf = await reboot('principal', PRINCIPAL, (f) => f.getByRole('button', { name: 'Sub-wallets' }));
});
await wait(2500);

await step('go to sub-wallets', async () => {
  await pf.getByRole('button', { name: 'Sub-wallets' }).click();
  await wait(2200);
  await pf.getByRole('button', { name: /NEW SUB-WALLET/i }).click();
});
await wait(3000);

await step('create sub-wallet', async () => {
  await pf
    .getByRole('button', { name: /^Agent \+/i })
    .first()
    .click();
  await wait(1200);
  await pf.getByLabel('SUB-WALLET NAME').fill('Tunde — school run');
  await wait(1000);
  await pf.getByRole('button', { name: /CREATE SUB-WALLET/i }).click();
});
await wait(4500);

// ── 6. Limits ──────────────────────────────────────────────────────────────
await cap(
  '6 · The control',
  'The parent caps what can be spent in a day…',
  'The agent app cannot override any of this — it is checked on the server.',
);
// Sub-wallet rows and the "Edit" affordance are plain Pressables with no accessibilityRole,
// so these are text selectors rather than getByRole. (Worth adding roles — see README.)
await step('open sub-wallet', async () => {
  await pf.getByText('Tunde — school run').first().click();
});
await wait(2800);
await step('open the rules editor', async () => {
  await pf.getByText('Edit', { exact: true }).first().click();
  await wait(2200);
  await pf.getByLabel('AMOUNT (₦)').fill('20000');
});
await wait(2500);

await cap(
  '6 · The control',
  '…and locks it to the categories they choose.',
  'Set here by the parent, enforced on the server for every payment.',
);
await step('set the category lock', async () => {
  await pf.getByRole('button', { name: 'Only these', exact: true }).click();
  await wait(1500);
  for (const c of ['Transport', 'School', 'Food & market']) {
    await pf.getByRole('button', { name: c }).click();
    await wait(700);
  }
});
await wait(2000);

await step('publish the rules', async () => {
  await pf.getByRole('button', { name: /PUBLISH RULES/i }).click();
});
await wait(4500);

// ── 7. Agent spends ────────────────────────────────────────────────────────
await focus('agent');
await cap(
  '7 · The agent',
  'The agent’s phone now shows the sub-wallet it was given.',
  'Until the parent issues one, the agent app has nothing to spend from.',
);
let af = null;
await step('agent picks up the sub-wallet', async () => {
  // react-navigation bottom-tabs on web does not expose a tab/button role here, so match
  // the visible label instead.
  af = await reboot('agent', AGENT, (f) => f.getByText('Pay', { exact: true }));
});
await wait(3000);

await cap(
  '7 · Spending',
  'Paying a vendor is a normal bank transfer out.',
  'The vendor needs no app and no Amana account — just an account number.',
);
await step('agent opens pay', async () => {
  await af.getByText('Pay', { exact: true }).first().click();
});
await wait(3500);

await page.screenshot({ path: `${OUT}/record-agent-pay.png` });

await step('enter vendor account', async () => {
  await af.getByText('Enter details', { exact: true }).click();
  await wait(2200);
  await af.getByRole('button', { name: /Select bank/i }).click();
  await wait(1600);
  await af.getByRole('button', { name: 'Guaranty Trust Bank' }).click();
  await wait(1400);
  await af.getByLabel('ACCOUNT NUMBER').fill('0123456789');
  await wait(1200);
  await af.getByRole('button', { name: /CONFIRM NAME/i }).click();
});
await wait(4000);

await cap(
  '7 · Spending',
  'The bank confirms who owns that account before anything moves.',
  'NIP name enquiry — the agent sees the real account name, not a guess.',
);
await wait(3500);

await step('confirm and send', async () => {
  await af.getByLabel('AMOUNT (₦)').fill('7500');
  await wait(1200);
  // Tagging the payment is what the parent's category lock is checked against.
  await af.getByRole('button', { name: 'Transport' }).click();
  await wait(1200);
  await af.getByRole('button', { name: 'CONFIRM PAYMENT' }).click();
});
await wait(5000);
await page.screenshot({ path: `${OUT}/record-agent-sending.png` });

await cap(
  '8 · Settlement',
  'The bank confirms the transfer and the ledger settles.',
  'Double-entry postings — every naira is accounted for on both sides.',
);
await step('settle at the bank', async () => {
  // Settle THIS spend by reference. The stub keeps every transfer of the session, so
  // "settle the last one" can pick up a transfer from an earlier run.
  if (!spendReference) throw new Error('never saw the spend idempotency key');
  await settleWhenReady(spendReference);
  // The Sending screen resolves either on a push (a no-op on web) or by polling the txn
  // every 3s, so wait for the receipt itself rather than a fixed sleep.
  await af
    .getByText(/Receipt|Sent|Paid/i)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
});
await wait(4000);
await page.screenshot({ path: `${OUT}/record-receipt.png` });

// ── 9. The exception ───────────────────────────────────────────────────────
// The most important beat: a spend the rules do NOT allow is held, not silently blocked,
// and the parent releases it from their own phone.
await cap(
  '9 · The exception',
  'Now the agent tries something the rules do not allow.',
  'Airtime was never on the parent’s list of allowed categories.',
);
await step('agent starts a blocked spend', async () => {
  await af.getByText('Pay', { exact: true }).first().click();
  await wait(2500);
  await af.getByText('Enter details', { exact: true }).click();
  await wait(2200);
  await af.getByRole('button', { name: /Select bank/i }).click();
  await wait(1600);
  await af.getByRole('button', { name: 'Guaranty Trust Bank' }).click();
  await wait(1400);
  await af.getByLabel('ACCOUNT NUMBER').fill('0123456789');
  await wait(1200);
  await af.getByRole('button', { name: /CONFIRM NAME/i }).click();
  await wait(3500);
  await af.getByLabel('AMOUNT (₦)').fill('3000');
  await wait(1200);
  await af.getByRole('button', { name: 'Airtime & data' }).click();
  await wait(1400);
  await af.getByRole('button', { name: 'CONFIRM PAYMENT' }).click();
});
await wait(4000);

await cap(
  '9 · The exception',
  'It is not refused — it is held, and the parent is asked.',
  'A blocked spend becomes a request, so nobody is stranded at the counter.',
);
await wait(3000);
await page.screenshot({ path: `${OUT}/record-held.png` });

await focus('principal');
await step('principal approves from their phone', async () => {
  pf = await reboot('principal', PRINCIPAL, (f) =>
    f.getByRole('button', { name: /Pending requests/i }),
  );
  await wait(2000);
  await pf.getByRole('button', { name: /Pending requests/i }).click();
  await wait(3000);
  await pf.getByRole('button', { name: 'APPROVE' }).first().click();
});
await wait(5000);
await page.screenshot({ path: `${OUT}/record-approved.png` });

await focus('agent');
await cap(
  '9 · The exception',
  'One tap from the parent, and the payment goes through.',
  'The rule held. The parent decided. Nothing to argue about afterwards.',
);
await step('the released payment settles', async () => {
  await settleWhenReady(spendReference, 40);
  await af
    .getByText(/Receipt|Sent|Paid/i)
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });
});
await wait(4000);
await page.screenshot({ path: `${OUT}/record-exception-receipt.png` });

// ── 10. Beyond transfers ───────────────────────────────────────────────────
// Deliberately framed as the control primitive extending, not as feature breadth. The
// interesting thing is not that the wallet sells airtime — every wallet does — it is that
// the parent's lock reaches it.
await cap(
  '10 · Beyond transfers',
  'The same wallet buys airtime, data, electricity and cable.',
  'Paid straight to the biller — no cash, no top-up card, no middleman.',
);
await step('agent opens airtime & bills', async () => {
  await af.getByRole('button', { name: /^DONE$/i }).click();
  await wait(2500);
  await af.getByRole('button', { name: /Buy airtime, data or pay a bill/i }).click();
  await wait(3000);
  await af.getByRole('button', { name: 'MTN Nigeria' }).click();
  await wait(1500);
  await af.getByLabel('PHONE NUMBER').fill(AGENT_PHONE);
  await wait(900);
  await af.getByLabel('AMOUNT (₦)').fill('1000');
});
await wait(2500);

await cap(
  '10 · Beyond transfers',
  'And the parent’s category lock reaches this too.',
  'Airtime was never on the allowed list, so it is refused — not quietly permitted.',
);
await step('the locked category refuses it', async () => {
  await af.getByRole('button', { name: 'BUY', exact: true }).click();
  await af
    .getByText(/has not allowed this category/i)
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
});
await wait(3500);
await page.screenshot({ path: `${OUT}/record-vas-blocked.png` });

await focus('principal');
await cap(
  '10 · Beyond transfers',
  'The parent decides to allow it.',
  'One tap in the same editor — and it applies everywhere the money can go.',
);
await step('parent allows airtime', async () => {
  pf = await reboot('principal', PRINCIPAL, (f) => f.getByRole('button', { name: 'Sub-wallets' }));
  await pf.getByRole('button', { name: 'Sub-wallets' }).click();
  await wait(2200);
  await pf.getByText('Tunde — school run').first().click();
  await wait(2500);
  await pf.getByText('Edit', { exact: true }).first().click();
  await wait(2500);
  await pf.getByRole('button', { name: 'Airtime & data' }).click();
  await wait(1500);
  await pf.getByRole('button', { name: /PUBLISH RULES/i }).click();
});
await wait(4000);

await focus('agent');
await cap(
  '10 · Beyond transfers',
  'And now it goes through.',
  'Same purchase, same wallet — the only thing that changed is the parent’s rule.',
);
await step('airtime purchase succeeds', async () => {
  await af.getByRole('button', { name: 'BUY', exact: true }).click();
  await af
    .getByText(/Receipt/i)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
});
await wait(4000);
await page.screenshot({ path: `${OUT}/record-vas-receipt.png` });

// ── outro ──────────────────────────────────────────────────────────────────
await cap(
  'Amana',
  'One wallet. Many agents. Every naira under control.',
  'Controlled-spend wallet for Nigeria',
);
await wait(5000);

await page.screenshot({ path: `${OUT}/record-final.png` });
await context.close();
await browser.close();
stageServer.close();

writeFileSync(
  `${OUT}/timings.json`,
  JSON.stringify({ totalMs: Date.now() - t0, timings }, null, 2),
);
console.log(`\nvideo written under ${OUT}/video/  (timings → ${OUT}/timings.json)`);
if (failures.length) {
  console.log(`\n${failures.length} step(s) failed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('all steps ok');
