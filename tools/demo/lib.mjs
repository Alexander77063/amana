// Shared helpers for the demo driver.

export const API = process.env.API_URL ?? 'http://localhost:3100';
export const STUB = process.env.STUB_URL ?? 'http://localhost:3200';
export const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'demo-admin-key-000000000000000000';
export const OTP = process.env.DEV_OTP_BYPASS_CODE ?? '123456';

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
  if (admin) headers['x-admin-api-key'] = ADMIN_KEY;
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
