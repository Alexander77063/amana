// Shared helpers for the demo driver.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
// The built artifact, by path, because workspace packages are not linked at the repo root and the
// dist barrel uses extensionless imports Node's ESM loader will not resolve. Imported rather than
// retyped so a version bump reaches these scripts too — a private copy per caller is exactly how
// the apps came to be refused at signup for three weeks.
// Requires `pnpm --filter @amana/types build` first.
import { AGENT_TERMS_VERSION, PRINCIPAL_TERMS_VERSION } from '../../packages/types/dist/auth.js';

export const API = process.env.API_URL ?? 'http://localhost:3100';
export const STUB = process.env.STUB_URL ?? 'http://localhost:3200';
export const OTP = process.env.DEV_OTP_BYPASS_CODE ?? '123456';
export const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'demo-ops@amana-ng.com';

const psql = (sql) =>
  execFileSync('docker', [
    'exec',
    'amana-postgres',
    'psql',
    '-U',
    'amana',
    '-d',
    'amana_dev',
    // `-q` or the `INSERT 0 1` command tag lands on stdout too and `RETURNING id` comes back as a
    // uuid with a second line stuck to it.
    '-qtA',
    '-c',
    sql,
  ])
    .toString()
    .trim();

let cachedToken = null;

/**
 * An `ops` session, minted straight into Postgres — the row `adminIdentityService` writes after a
 * Google callback.
 *
 * **Why this replaced a header.** These scripts used to send a shared `x-admin-api-key`. Sub-plan
 * A1 Task 4 **deleted that secret** — `env.ts` says "GONE, not deprecated" — so every ops call
 * here 401'd and each script failed somewhere downstream of the real cause. Google sign-in cannot
 * be driven by a script, so the session is created directly; everything after it is real, including
 * the session middleware and the permission checks.
 *
 * `ops` holds `vendor.*` and `retailer.*`, which is what these probes exercise. Cached so repeated
 * calls in one run reuse a single session rather than piling up rows.
 */
export function adminSessionToken() {
  if (cachedToken) return cachedToken;
  const id = psql(`INSERT INTO admin_users (email, status, provisioning_source)
    VALUES ('${ADMIN_EMAIL}', 'active', 'admin')
    ON CONFLICT (email) DO UPDATE SET status = 'active' RETURNING id`);
  // Idempotent in effect: the grant log folds by `seq`, latest row per (admin, role) wins.
  psql(`INSERT INTO admin_role_grants (admin_user_id, role, granted, source, reason)
    VALUES ('${id}', 'ops', true, 'config', 'demo probe')`);
  const token = randomBytes(32).toString('base64url');
  // Plain SHA-256 **hex** is what `resolveSession` looks the row up by; anything else 401s and the
  // script would look broken for the wrong reason.
  const hash = createHash('sha256').update(token).digest('hex');
  psql(`INSERT INTO admin_sessions (id, admin_user_id, token_hash, expires_at)
    VALUES ('${randomUUID()}', '${id}', '${hash}', now() + interval '2 hours')`);
  cachedToken = token;
  return token;
}

/** Header pair for an authenticated ops call. Requires Postgres to be up and migrated. */
export const adminCookie = () => ({ cookie: `amana_admin_session=${adminSessionToken()}` });

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

let stepNo = 0;
export const failures = [];

export function phase(title) {
  console.log(
    `\n${C.bold}${C.cyan}━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}${C.reset}`,
  );
}

export function note(msg) {
  console.log(`${C.dim}   ${msg}${C.reset}`);
}

export function ok(label, detail = '') {
  console.log(
    `${C.green}  ✓${C.reset} ${String(++stepNo).padStart(2)}. ${label} ${C.dim}${detail}${C.reset}`,
  );
}

export function bad(label, detail = '') {
  failures.push({ label, detail });
  console.log(
    `${C.red}  ✗${C.reset} ${String(++stepNo).padStart(2)}. ${label} ${C.red}${detail}${C.reset}`,
  );
}

/** One HTTP call. Never throws — returns {status, body} so the driver can report every step. */
export async function call(path, { method = 'GET', token, admin, body, base = API } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  // A real ops session. The shared `x-admin-api-key` this used to send was deleted in A1 Task 4.
  if (admin) Object.assign(headers, adminCookie());
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Assert a call succeeded; log either way and return the body. */
export async function step(label, path, opts = {}, expect = [200, 201, 202]) {
  const r = await call(path, opts);
  if (expect.includes(r.status)) {
    ok(label, `${opts.method ?? 'GET'} ${path} → ${r.status}`);
  } else {
    bad(
      label,
      `${opts.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
    );
  }
  return r.body;
}

export const stub = (path, body) => call(path, { method: 'POST', body, base: STUB });

export const naira = (koboStr) =>
  `₦${(Number(koboStr) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

let phoneSeq = 0;
const runTag = String(Date.now()).slice(-7);
export const newPhone = () => `+2348${runTag}${String(++phoneSeq).padStart(2, '0')}`.slice(0, 15);
export const newNin = () =>
  String(22222222222n + BigInt(Date.now() % 100000) + BigInt(++phoneSeq)).slice(-11);
export const newBvn = () =>
  String(33333333333n + BigInt(Date.now() % 100000) + BigInt(++phoneSeq)).slice(-11);
export const idem = (p) => `${p}-${runTag}-${++phoneSeq}`;

/** Sign up (or log in) a user through the real OTP flow, using the dev bypass code. */
export async function login(phone, { nin, bvn, pairingCode } = {}) {
  await call('/auth/otp/request', {
    method: 'POST',
    body: { phone, purpose: pairingCode ? 'pair' : 'login' },
  });
  const r = await call('/auth/otp/verify', {
    method: 'POST',
    body: {
      phone,
      code: OTP,
      // Required whenever this call CREATES a user, which is every signup these scripts perform.
      // A `pairingCode` means an agent is being paired; anything else that creates is a principal.
      // Omitting it returns `terms_not_accepted`, and the probe then fails several steps later
      // reading `.user.id` off a body that never existed.
      acceptedTermsVersion: pairingCode ? AGENT_TERMS_VERSION : PRINCIPAL_TERMS_VERSION,
      ...(nin && { nin }),
      ...(bvn && { bvn }),
      ...(pairingCode && { pairingCode }),
    },
  });
  return r;
}

export function summary() {
  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}${C.bold}ALL ${stepNo} STEPS PASSED${C.reset}`);
    return 0;
  }
  console.log(`${C.red}${C.bold}${failures.length} of ${stepNo} STEPS FAILED${C.reset}`);
  for (const f of failures) console.log(`${C.red}  ✗ ${f.label}${C.reset} — ${f.detail}`);
  return 1;
}
