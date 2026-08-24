// Does the retailer portal actually work against a live backend?
//
//   node tools/demo/probe-portal.mjs
//
// Seeds a retailer through the ops admin API exactly as onboarding does, then drives the portal
// in a real browser: sign in with OTP, publish a service, see it listed. Building and
// typechecking prove neither that the two halves agree on the wire nor that a browser can
// actually reach them — the demo work found nine bugs that only this kind of pass catches.

import { chromium } from 'playwright';

const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3100';
const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:3300';
const ADMIN = process.env.ADMIN_API_KEY ?? 'demo-admin-key-000000000000000000';

const tag = String(Date.now()).slice(-7);
const PHONE = `+2349${tag}11`;

const j = async (path, init = {}) => {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-admin-api-key': ADMIN, ...init.headers },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

// 1. Ops create the business and record the number its owner will sign in with.
const created = await j('/retailers', {
  method: 'POST',
  body: JSON.stringify({
    businessName: `Probe Salon ${tag}`,
    payoutBankCode: '000014',
    payoutAccountNumber: '0123456789',
  }),
});
const retailerId = created.body?.retailer?.id ?? created.body?.id;
console.log(`retailer   : ${created.status} ${retailerId}`);
if (!retailerId) {
  console.log(JSON.stringify(created.body).slice(0, 300));
  process.exit(1);
}

// The contact phone is what the owner claims the business with; ops set it at creation time in
// production. There is no admin route for it yet, so the probe writes it directly.
const { spawnSync } = await import('node:child_process');
const sql = `update retailers set contact_phone = '${PHONE}', onboarding_status = 'approved',
   approved_at = now(), anchor_business_customer_id = 'probe-${tag}' where id = '${retailerId}'`;
const psql = spawnSync(
  'docker',
  ['exec', 'amana-postgres', 'psql', '-U', 'amana', '-d', 'amana_dev', '-c', sql],
  { encoding: 'utf8' },
);
if (psql.status !== 0) {
  console.log('seed failed:', psql.stderr?.slice(0, 300));
  process.exit(1);
}
console.log(`claimable  : ${PHONE}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  // "Failed to load resource" duplicates the response listener below, without the URL that makes
  // it actionable. Keep the version that names what failed.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
// Two classes of noise are expected and filtered, so anything left is worth reading:
//   ?_rsc=  — Next route prefetches, aborted the moment navigation happens. Playwright reports
//            an aborted request as failed; it is not.
//   404 on /retailer/redeem — the unknown-code step below asks for a voucher that does not
//            exist, on purpose. A 404 there IS the passing result.
const EXPECTED = [/\?_rsc=/, /\/retailer\/redeem$/];
const noise = (url) => EXPECTED.some((re) => re.test(url));
page.on('requestfailed', (r) => {
  if (!noise(r.url())) errors.push(`requestfailed ${r.url()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !noise(r.url())) errors.push(`${r.status()} ${r.url()}`);
});

let failed = 0;
const step = async (label, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    console.log(`  ✗ ${label}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `tools/demo/out/portal-FAIL-${label.replace(/\W+/g, '-')}.png` });
    failed++;
  }
};

// `load`, not `networkidle`: Next's dev server holds an HMR websocket open, so the network is
// never idle and that wait can only ever time out. The generous budget is for the first
// on-demand compile.
await page.goto(PORTAL, { waitUntil: 'load', timeout: 120_000 });

await step('sign-in page renders', async () => {
  await page.getByLabel('Phone number').waitFor({ timeout: 15_000 });
});

await step('requests an OTP', async () => {
  await page.getByLabel('Phone number').fill(PHONE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Six-digit code').waitFor({ timeout: 15_000 });
});

await step('first sign-in completes in one round trip with the NIN', async () => {
  await page.getByLabel('Six-digit code').fill('123456');
  // The NIN field is offered up front precisely so this works first time: the server cannot know
  // a NIN is needed until it has verified — and consumed — the code.
  await page
    .getByLabel('NIN — first sign-in only')
    .fill(String(33333333333n + BigInt(tag)).slice(-11));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/storefront', { timeout: 25_000 });
});

await step('shows the business name in the nav', async () => {
  await page.getByText(`Probe Salon ${tag}`).waitFor({ timeout: 10_000 });
});

await step('publishes a service and lists it at the right price', async () => {
  await page.getByLabel('Service name').fill('Wash and set');
  await page.getByLabel('Price (₦)').fill('4820.50');
  await page.getByLabel('Section').fill('hair');
  await page.getByRole('button', { name: 'Add service' }).click();
  // ₦4,820.50 proves the naira→kobo→naira round trip and the thousands separator.
  await page.getByText('₦4,820.50').waitFor({ timeout: 15_000 });
});

await step('earnings reports history, not a balance', async () => {
  await page.getByRole('link', { name: 'Earnings' }).click();
  await page.getByText('Paid to your bank').waitFor({ timeout: 15_000 });
  const body = (await page.locator('body').textContent()) ?? '';
  if (/balance/i.test(body)) throw new Error('the word "balance" appears on the earnings screen');
});

await step('redeem refuses an unknown code without crashing', async () => {
  await page.getByRole('link', { name: 'Redeem' }).click();
  await page.getByLabel('Voucher code').fill('NOSUCHCODE');
  await page.getByRole('button', { name: 'Service delivered' }).click();
  await page.locator('.banner.bad').waitFor({ timeout: 15_000 });
});

await step('KYB screen shows the verified state', async () => {
  await page.getByRole('link', { name: 'Business & KYB' }).click();
  await page.getByText('Owner BVN').waitFor({ timeout: 15_000 });
});

await page.screenshot({ path: 'tools/demo/out/portal-final.png' });
await browser.close();

console.log(
  errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors',
);
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps ok');
process.exit(failed);
