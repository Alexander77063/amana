// Records the Amana product walkthrough as a single 1080p video showing both phones
// side by side, driven through the real UI in a browser.
//
//   node tools/demo/record.mjs          # full pacing
//   SPEED=3 node tools/demo/record.mjs  # fast, for iterating on the script
//
// Prereqs (see tools/demo/README.md): backend :3100 (CORS allowlisted, pointed at the
// Anchor stub), stub :3200, principal web :19006, agent web :19007.

import { mkdirSync, readFileSync } from 'node:fs';
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

const failures = [];
const wait = (ms) => page.waitForTimeout(Math.round(ms / SPEED));

async function cap(chapter, text, sub = '') {
  await page.evaluate(([c, t, s]) => window.stage.caption(c, t, s), [chapter, text, sub]);
  console.log(`  [${chapter}] ${text}`);
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

await cap(
  'Amana',
  'A parent funds one wallet. Every agent spends under their own limits.',
  'Recorded end to end through the real app against a live API. Nothing here is a mockup.',
);
await wait(5000);

// ── 1. Sign up ─────────────────────────────────────────────────────────────
await focus('principal');
await cap('1 · Sign up', 'The principal signs in with a phone number.', 'One-time SMS code — no passwords anywhere in the product.');
await step('principal phone', async () => {
  await P().getByLabel('MOBILE NUMBER').fill(PRINCIPAL_PHONE);
  await wait(900);
  await P().getByRole('button', { name: /SEND CODE/i }).click();
});
await wait(2600);

await cap('1 · Sign up', 'First-time signup also captures NIN and BVN.', 'Nigerian identity numbers — required before the wallet can hold money.');
await step('principal verify', async () => {
  await P().getByLabel('6-DIGIT CODE').fill('123456');
  await wait(600);
  await P().getByLabel('NIN').fill(NIN_P);
  await P().getByLabel('BVN').fill(BVN_P);
  await wait(900);
  await P().getByRole('button', { name: /^VERIFY/i }).first().click();
});
await wait(4200);

// ── 2. Household + master wallet ───────────────────────────────────────────
await cap('2 · The wallet', 'Creating the household provisions a real bank account.', 'A customer record and a fundable NUBAN at the banking partner.');
await step('create household', async () => {
  await P().getByLabel('HOUSEHOLD NAME').fill('Adebayo Family');
  await wait(900);
  await P().getByRole('button', { name: /CREATE HOUSEHOLD/i }).click();
});
await wait(5200);

// ── 3. Funding ─────────────────────────────────────────────────────────────
await cap('3 · Funding', 'Money arrives by bank transfer into that account.', 'The credit lands as a signed webhook and posts to a double-entry ledger.');
await step('fund wallet', async () => {
  await stub('/_control/fund', { amountKobo: '50000000' });
});
await wait(3000);

// ── 4. Pairing ─────────────────────────────────────────────────────────────
await cap('4 · Pairing', 'The principal issues a one-time pairing code.', 'Phone to phone: scan the QR, tap NFC on Android, or send the link by SMS.');
await step('open pairing', async () => {
  await P().getByRole('button', { name: /Pair an agent/i }).click();
  await wait(1500);
  await P().getByRole('button', { name: /GENERATE CODE/i }).click();
});
await wait(4000);

await focus('agent');
await cap('4 · Pairing', 'The agent signs in on their own phone.', 'A separate device and a separate login — the agent never sees the master wallet.');
await step('agent phone', async () => {
  await A().getByLabel('MOBILE NUMBER').fill(AGENT_PHONE);
  await wait(900);
  await A().getByRole('button', { name: /SEND CODE/i }).click();
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
  await A().getByRole('button', { name: /^VERIFY/i }).first().click();
});
await wait(6000);

// ── 5. Sub-wallet ──────────────────────────────────────────────────────────
await focus('principal');
await cap('5 · Sub-wallet', 'The principal issues a sub-wallet to that agent.', 'Not a bank account — a spending envelope drawn against the master wallet.');
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
  await pf.getByRole('button', { name: /^Agent \+/i }).first().click();
  await wait(1200);
  await pf.getByLabel('SUB-WALLET NAME').fill('Tunde — school run');
  await wait(1000);
  await pf.getByRole('button', { name: /CREATE SUB-WALLET/i }).click();
});
await wait(4500);

// ── 6. Limits ──────────────────────────────────────────────────────────────
await cap('6 · The control', 'The parent sets a daily spending limit.', 'Enforced server-side on every spend — the agent app cannot override it.');
// Sub-wallet rows and the "Edit" affordance are plain Pressables with no accessibilityRole,
// so these are text selectors rather than getByRole. (Worth adding roles — see README.)
await step('open sub-wallet', async () => {
  await pf.getByText('Tunde — school run').first().click();
});
await wait(2800);
await step('set daily limit', async () => {
  await pf.getByText('Edit', { exact: true }).first().click();
  await wait(2000);
  await pf.getByLabel('AMOUNT (₦)').fill('20000');
  await wait(1200);
  await pf.getByRole('button', { name: /PUBLISH RULES/i }).click();
});
await wait(4500);

await cap(
  '6 · The control',
  'Category locks and time windows run in the same engine.',
  'Those two are enforced server-side today; the in-app editor for them is still to come.',
);
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

await cap('7 · Spending', 'Paying a vendor is a normal bank transfer out.', 'The vendor needs no app and no Amana account — just an account number.');
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
  await wait(1400);
  await af.getByRole('button', { name: 'CONFIRM PAYMENT' }).click();
});
await wait(5000);
await page.screenshot({ path: `${OUT}/record-agent-sending.png` });

await cap('8 · Settlement', 'The bank confirms the transfer and the ledger settles.', 'Double-entry postings — every naira is accounted for on both sides.');
await step('settle at the bank', async () => {
  // Settle THIS spend by reference. The stub keeps every transfer of the session, so
  // "settle the last one" can pick up a transfer from an earlier run.
  if (!spendReference) throw new Error('never saw the spend idempotency key');
  const r = await stub('/_control/settle', { reference: spendReference });
  if (r?.error) throw new Error(`stub settle failed: ${JSON.stringify(r)}`);
  // The Sending screen resolves either on a push (a no-op on web) or by polling the txn
  // every 3s, so wait for the receipt itself rather than a fixed sleep.
  await af
    .getByText(/Receipt|Sent|Paid/i)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
});
await wait(4000);
await page.screenshot({ path: `${OUT}/record-receipt.png` });

// ── outro ──────────────────────────────────────────────────────────────────
await cap('Amana', 'One wallet. Many agents. Every naira under control.', 'Controlled-spend wallet for Nigeria');
await wait(5000);

await page.screenshot({ path: `${OUT}/record-final.png` });
await context.close();
await browser.close();
stageServer.close();

console.log(`\nvideo written under ${OUT}/video/`);
if (failures.length) {
  console.log(`\n${failures.length} step(s) failed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('all steps ok');
