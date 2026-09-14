// Does the admin portal actually work in a browser, against a live backend?
//
//   pnpm --filter @amana/backend dev       # :3000
//   pnpm --filter @amana/admin-portal dev  # :3400
//   node tools/demo/probe-admin-portal.mjs
//
// Sign-in is Google's, which no script can drive, so this mints a session directly in Postgres —
// exactly the row `adminIdentityService` writes after a callback — and drops the cookie into the
// browser. Everything after that is real: the proxy, the host-only cookie, the permissions the
// rail is built from, and every screen. Building and typechecking prove neither that the two
// halves agree on the wire nor that a browser can reach them.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:3400';
const EMAIL = process.env.PROBE_EMAIL ?? 'probe-ops@amana-ng.com';
const OUT = 'tools/demo/out';

const psql = (sql) =>
  execFileSync('docker', [
    'exec',
    'amana-postgres',
    'psql',
    '-U',
    'amana',
    '-d',
    'amana_dev',
    // `-q` matters: without it psql prints the `INSERT 0 1` command tag on stdout too, and the
    // `RETURNING id` read below would come back as a uuid with a second line stuck to it.
    '-qtA',
    '-c',
    sql,
  ])
    .toString()
    .trim();

/**
 * `ops` + `admin` between them hold every permission the rail gates a link on — `vendor.read`,
 * `retailer.read`, `iam.read` — so all four sections must render. The token is 32 random bytes and
 * the stored digest is a plain SHA-256 **hex**, which is what `resolveSession` looks the row up
 * by; anything else 401s and the probe would look broken for the wrong reason.
 */
function mintSession() {
  const id = psql(`INSERT INTO admin_users (email, status, provisioning_source)
    VALUES ('${EMAIL}', 'active', 'admin')
    ON CONFLICT (email) DO UPDATE SET status = 'active' RETURNING id`);
  for (const role of ['ops', 'admin']) {
    // Appending the same grant on a re-run is harmless: the log is folded by `seq` and the latest
    // row per (admin, role) wins, so re-granting `true` is idempotent in effect.
    psql(`INSERT INTO admin_role_grants (admin_user_id, role, granted, source, reason)
      VALUES ('${id}', '${role}', true, 'config', 'probe')`);
  }
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  psql(`INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at)
    VALUES ('${randomUUID()}', '${id}', '${hash}', now() + interval '1 hour')`);
  return token;
}

const token = mintSession();
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([
  { name: 'amana_admin_session', value: token, url: PORTAL, httpOnly: true, sameSite: 'Lax' },
]);
const page = await ctx.newPage();

// One class of noise is expected and filtered, so anything left is worth reading:
//   ?_rsc=  — Next route prefetches, aborted the moment navigation happens. Playwright reports an
//            aborted request as failed; it is not.
const EXPECTED = [/\?_rsc=/];
const noise = (url) => EXPECTED.some((re) => re.test(url));
const bad = [];
// Every backend path the browser got a 2xx from. A screen with nothing to list looks identical
// whether its read succeeded or was never made, so "the heading appeared" is not on its own
// evidence that the portal and the API agree — this is.
const served = new Set();
page.on('pageerror', (e) => bad.push(`pageerror ${e.message}`));
page.on('console', (m) => {
  // "Failed to load resource" duplicates the response listener below, without the URL that makes
  // it actionable. Keep the version that names what failed.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push(m.text());
});
page.on('requestfailed', (r) => {
  // The errorText is the whole diagnosis — `net::ERR_ABORTED` is a navigation racing a fetch,
  // anything else is the network genuinely refusing. Reporting the URL alone hides which.
  if (!noise(r.url())) bad.push(`requestfailed ${r.url()} ${r.failure()?.errorText ?? ''}`.trim());
});
page.on('response', (r) => {
  if (r.status() >= 400 && !noise(r.url())) bad.push(`${r.status()} ${r.url()}`);
  if (r.status() < 400) served.add(new URL(r.url()).pathname);
});

let failed = 0;
async function step(label, fn) {
  try {
    await fn();
    console.log(`ok   ${label}`);
  } catch (e) {
    console.log(`FAIL ${label}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/admin-FAIL-${label.replace(/\W+/g, '-')}.png` });
    failed++;
  }
}

// The rail's links are the assertion; a list row that happens to share a name is not. Scoping to
// the nav also keeps the click unambiguous under Playwright's strict mode.
const railLink = (name) => page.locator('nav[aria-label="Sections"]').getByRole('link', { name });

// `load`, not `networkidle`: Next's dev server holds an HMR websocket open, so the network is never
// idle and that wait can only ever time out. The generous budget is for the first on-demand
// compile of each route.
await page.goto(`${PORTAL}/sign-in`, { waitUntil: 'load', timeout: 120_000 });

await step('sign-in page renders and links to /admin/auth/start', async () => {
  const link = page.getByRole('link', { name: 'Sign in with Google' });
  await link.waitFor({ timeout: 30_000 });
  const href = await link.getAttribute('href');
  if (href !== '/admin/auth/start') throw new Error(`href ${href}`);
});

await step('inbox shows the signed-in person through the proxy', async () => {
  await page.goto(PORTAL, { waitUntil: 'load', timeout: 120_000 });
  await page.getByText(EMAIL).waitFor({ timeout: 30_000 });
  await page
    .getByRole('heading', { name: 'Waiting for a second person' })
    .waitFor({ timeout: 30_000 });
});

await step('vendors, retailers and people render', async () => {
  for (const [name, heading] of [
    ['Vendors', 'Vendors'],
    ['Retailers', 'Retailers'],
    ['People', 'People'],
  ]) {
    await railLink(name).click();
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 60_000 });
  }
});

await step('every screen actually read from the API through the proxy', async () => {
  // One per rail section plus the shell: the inbox's two lists, the vendor claim queue and
  // registry, the retailer list, the staff list, and `me`, which every screen renders from.
  const required = [
    '/admin/me',
    '/admin/approvals',
    '/vendors-admin/claim-queue',
    '/vendors-admin/vendors',
    '/retailers',
    '/admin/iam/admins',
  ];
  // Poll rather than read once. Every screen paints its heading first and fills in from an
  // effect, so the last section's read is still in flight when its heading appears — checking
  // immediately made this assertion pass or fail on how fast the last route compiled.
  const deadline = Date.now() + 30_000;
  let missing = required.filter((p) => !served.has(p));
  while (missing.length && Date.now() < deadline) {
    await page.waitForTimeout(250);
    missing = required.filter((p) => !served.has(p));
  }
  if (missing.length) throw new Error(`never served 2xx: ${missing.join(', ')}`);
});

await page.screenshot({ path: `${OUT}/admin-final.png` });

// Everything the page does after sign-out is unauthenticated by design — the layout's in-flight
// /admin/me and /admin/approvals both 401 on the way to the redirect. Anything recorded before
// this index has no such excuse, so only the tail is forgiven.
const beforeSignOut = bad.length;

await step('sign out clears the session', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/sign-in/, { timeout: 30_000 });
  await page.goto(PORTAL, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForURL(/\/sign-in/, { timeout: 30_000 });
});

await step('no console errors or 4xx/5xx during the pass', async () => {
  const unexpected = bad
    .slice(0, beforeSignOut)
    .concat(bad.slice(beforeSignOut).filter((b) => !/^401 /.test(b)));
  if (unexpected.length) throw new Error(unexpected.join('; '));
});

await browser.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps ok');
process.exit(failed);
