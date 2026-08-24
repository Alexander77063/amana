// Local Anchor BaaS stub for the investor demo.
//
// The backend has NO mock code path by design: sandbox vs production is purely environmental
// (`ANCHOR_API_BASE_URL`). This stub uses that same seam — point the backend at it and nothing
// in the product changes. It speaks the FLAT internal contract the adapter expects, not
// Anchor's nested JSON:API shape.
//
// It also exposes a small control plane (`/_control/*`) so a demo script can fire correctly
// SIGNED webhooks on cue — making the whole money lifecycle deterministic and repeatable
// instead of waiting on a third party.
//
//   STUB_PORT=3200 BACKEND_URL=http://localhost:3100 \
//   ANCHOR_WEBHOOK_SECRET=whsec_demo_local node tools/anchor-stub/server.mjs

import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 3200);
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3100';
const WEBHOOK_SECRET = process.env.ANCHOR_WEBHOOK_SECRET ?? 'whsec_demo_local';

const state = {
  customers: new Map(),
  businessCustomers: new Map(),
  virtualAccounts: new Map(),
  transfers: new Map(),
  transfersByReference: new Map(),
  bills: new Map(),
  events: [],
};

let seq = 0;
const nextId = (prefix) => `${prefix}_${String(++seq).padStart(4, '0')}`;

const log = (...args) => console.log('[anchor-stub]', ...args);

function send(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/** POST a correctly-signed webhook to the backend, exactly as Anchor would. */
async function emit(type, data, createdAt = new Date().toISOString()) {
  const event = { id: `evt_${randomUUID()}`, type, createdAt, data };
  const body = JSON.stringify(event);
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${BACKEND_URL}/webhooks/anchor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-anchor-signature': signature },
    body,
  });
  const text = await res.text();
  state.events.push({ type, status: res.status, at: createdAt });
  log(`emit ${type} -> ${res.status} ${text.slice(0, 120)}`);
  return { status: res.status, body: text, event };
}

// ── Route table ────────────────────────────────────────────────────────────
// Each entry: [method, matcher, handler]. Matchers get the parsed URL.

const routes = [
  // Personal customer (household onboarding).
  [
    'POST',
    (p) => p === '/customers',
    async (req, res, _u, body) => {
      const id = nextId('cust');
      const customer = {
        id,
        fullName: body.fullName ?? 'Demo Customer',
        phoneNumber: body.phoneNumber ?? '+2348000000000',
        kycLevel: 'TIER_1',
      };
      state.customers.set(id, { ...customer, nin: body.nin, bvn: body.bvn });
      log(`createCustomer -> ${id}`);
      send(res, 201, customer);
    },
  ],

  // Virtual account (the household's fundable NUBAN).
  [
    'POST',
    (p) => p === '/virtual-accounts',
    async (req, res, _u, body) => {
      const id = nextId('va');
      const va = {
        id,
        bankCode: '000014',
        // Deterministic 10-digit NUBAN so the demo shows a stable account number.
        accountNumber: String(9000000000 + state.virtualAccounts.size + 1),
        accountName: body.label ?? 'AMANA/DEMO',
        customerId: body.customerId,
        status: 'ACTIVE',
      };
      state.virtualAccounts.set(id, va);
      log(`provisionVirtualAccount -> ${id} ${va.accountNumber}`);
      send(res, 201, va);
    },
  ],

  // Business customer (marketplace retailer KYB, SP4a).
  [
    'POST',
    (p) => p === '/business-customers',
    async (req, res, _u, body) => {
      const id = nextId('biz');
      const biz = { id, businessName: body.businessName ?? 'Demo Retailer', kybStatus: 'PENDING' };
      state.businessCustomers.set(id, { ...biz, bvn: body.bvn, rcNumber: body.rcNumber });
      log(`createBusinessCustomer -> ${id} (${biz.businessName})`);
      send(res, 201, biz);
    },
  ],

  [
    'POST',
    (p) => p === '/kyc-verifications',
    async (req, res, _u, body) => {
      send(res, 202, { customerId: body.customerId, status: 'PENDING' });
    },
  ],

  // NIP name enquiry — used before an outbound transfer.
  [
    'GET',
    (p) => p === '/nibss/name-enquiry',
    async (req, res, u) => {
      send(res, 200, {
        bankCode: u.searchParams.get('bankCode') ?? '000014',
        accountNumber: u.searchParams.get('accountNumber') ?? '0000000000',
        accountName: 'ADEBAYO STORES LTD',
      });
    },
  ],

  [
    'GET',
    (p) => p === '/nibss/phone-lookup',
    async (req, res, u) => {
      send(res, 200, {
        bankCode: '000014',
        accountNumber: '0123456789',
        accountName: 'CHIOMA OKAFOR',
        phoneNumber: u.searchParams.get('phoneNumber') ?? '+2348000000000',
      });
    },
  ],

  // Reconciliation sweep looks transfers up by our reference.
  [
    'GET',
    (p) => p === '/transfers/by-reference',
    async (req, res, u) => {
      const ref = u.searchParams.get('reference') ?? '';
      const t = state.transfersByReference.get(ref);
      if (!t) return send(res, 404, { error: 'not_found' });
      send(res, 200, t);
    },
  ],

  // Outbound NIP transfer. Returns PENDING; the demo completes it via /_control/settle
  // so the settlement webhook lands exactly when the script wants it to.
  [
    'POST',
    (p) => p === '/transfers',
    async (req, res, _u, body) => {
      const id = nextId('tr');
      const transfer = { id, status: 'PENDING', reference: body.reference };
      state.transfers.set(id, { ...transfer, amountKobo: String(body.amountKobo ?? '0') });
      state.transfersByReference.set(body.reference, transfer);
      log(`transfer -> ${id} ref=${body.reference} amountKobo=${body.amountKobo}`);
      send(res, 202, transfer);
    },
  ],

  // ── Digital VAS (airtime / data / electricity / cable) ────────────────────
  [
    'GET',
    (p) => p === '/bills/billers',
    async (req, res, u) => {
      const category = u.searchParams.get('category') ?? 'Airtime';
      const catalogue = {
        Airtime: [
          { id: 'blr_mtn', name: 'MTN Nigeria', slug: 'mtn' },
          { id: 'blr_airtel', name: 'Airtel Nigeria', slug: 'airtel' },
          { id: 'blr_glo', name: 'Glo Nigeria', slug: 'glo' },
        ],
        Data: [{ id: 'blr_mtn_data', name: 'MTN Data', slug: 'mtn-data' }],
        Electricity: [{ id: 'blr_ekedc', name: 'Eko Electricity (EKEDC)', slug: 'ekedc' }],
        CableTV: [{ id: 'blr_dstv', name: 'DStv', slug: 'dstv' }],
      };
      send(res, 200, { data: catalogue[category] ?? [] });
    },
  ],

  [
    'GET',
    (p) => /^\/bills\/billers\/[^/]+\/products$/.test(p),
    async (req, res, u) => {
      const billerId = u.pathname.split('/')[3];
      const products = billerId.includes('data')
        ? [
            { id: 'prd_1gb', name: '1GB • 30 days', slug: '1gb-30', amountKobo: '30000' },
            { id: 'prd_5gb', name: '5GB • 30 days', slug: '5gb-30', amountKobo: '150000' },
          ]
        : [{ id: 'prd_topup', name: 'Airtime top-up', slug: 'topup', amountKobo: null }];
      send(res, 200, { data: products });
    },
  ],

  [
    'GET',
    (p) => p.startsWith('/bills/customer-validation/'),
    async (req, res, u) => {
      const [, , , , accountNumber] = u.pathname.split('/');
      send(res, 200, { valid: true, customerName: 'CHIOMA OKAFOR', accountNumber });
    },
  ],

  // Bill payment. Returns PENDING; completed via /_control/bill-success.
  [
    'POST',
    (p) => p === '/bills',
    async (req, res, _u, body) => {
      const id = nextId('bill');
      const bill = {
        id,
        status: 'PENDING',
        commissionKobo: null,
        token: null,
        failureReason: null,
      };
      state.bills.set(id, {
        ...bill,
        reference: body.reference,
        amountKobo: String(body.amountKobo),
      });
      log(`payBill -> ${id} ref=${body.reference}`);
      send(res, 202, bill);
    },
  ],
];

// ── Control plane (demo driver) ────────────────────────────────────────────

const controlRoutes = [
  [
    'GET',
    '/_control/health',
    async (req, res) => {
      send(res, 200, {
        status: 'ok',
        backend: BACKEND_URL,
        customers: state.customers.size,
        virtualAccounts: state.virtualAccounts.size,
        transfers: state.transfers.size,
        eventsEmitted: state.events.length,
      });
    },
  ],

  [
    'GET',
    '/_control/state',
    async (req, res) => {
      send(res, 200, {
        virtualAccounts: [...state.virtualAccounts.values()],
        businessCustomers: [...state.businessCustomers.values()],
        transfers: [...state.transfers.values()],
        events: state.events,
      });
    },
  ],

  // Money lands in the household's virtual account (a bank transfer in).
  [
    'POST',
    '/_control/fund',
    async (req, res, _u, body) => {
      const va =
        state.virtualAccounts.get(body.virtualAccountId) ??
        [...state.virtualAccounts.values()].at(-1);
      if (!va) return send(res, 400, { error: 'no_virtual_account_provisioned' });
      const out = await emit('virtual_account.credited', {
        virtualAccountId: va.id,
        amountKobo: String(body.amountKobo ?? '50000000'),
        senderBankCode: '000013',
        senderAccountNumber: '0987654321',
        senderAccountName: body.senderName ?? 'ADEOLA ADEBAYO',
        nibssSessionId: `1000${Date.now()}`.slice(0, 30),
      });
      send(res, 200, out);
    },
  ],

  // An outbound transfer settles at the bank.
  [
    'POST',
    '/_control/settle',
    async (req, res, _u, body) => {
      const t = body.reference
        ? state.transfersByReference.get(body.reference)
        : [...state.transfers.values()].at(-1);
      if (!t) return send(res, 400, { error: 'no_such_transfer', reference: body.reference });
      t.status = 'COMPLETED';
      const out = await emit('transfer.completed', {
        transferId: t.id,
        reference: t.reference,
        status: 'COMPLETED',
        nibssSessionId: `1000${Date.now()}`.slice(0, 30),
      });
      send(res, 200, out);
    },
  ],

  [
    'POST',
    '/_control/fail-transfer',
    async (req, res, _u, body) => {
      const t = body.reference
        ? state.transfersByReference.get(body.reference)
        : [...state.transfers.values()].at(-1);
      if (!t) return send(res, 400, { error: 'no_such_transfer' });
      t.status = 'FAILED';
      const out = await emit('transfer.failed', {
        transferId: t.id,
        reference: t.reference,
        status: 'FAILED',
        failureReason: body.reason ?? 'Beneficiary account inactive',
      });
      send(res, 200, out);
    },
  ],

  [
    'POST',
    '/_control/bill-success',
    async (req, res, _u, body) => {
      const out = await emit('bills.successful', {
        reference: body.reference,
        commissionKobo: String(body.commissionKobo ?? '0'),
        token: body.token ?? null,
      });
      send(res, 200, out);
    },
  ],

  [
    'POST',
    '/_control/bill-failed',
    async (req, res, _u, body) => {
      const out = await emit('bills.failed', {
        reference: body.reference,
        failureReason: body.reason ?? 'Biller unavailable',
      });
      send(res, 200, out);
    },
  ],

  // Retailer Business KYB verdict (SP4a).
  [
    'POST',
    '/_control/kyb',
    async (req, res, _u, body) => {
      const businessCustomerId =
        body.businessCustomerId ?? [...state.businessCustomers.keys()].at(-1);
      if (!businessCustomerId) return send(res, 400, { error: 'no_business_customer' });
      const approved = body.approved !== false;
      const out = approved
        ? await emit('kyb.approved', { businessCustomerId })
        : await emit('kyb.rejected', { businessCustomerId, reason: body.reason ?? 'RC mismatch' });
      send(res, 200, out);
    },
  ],

  // Personal KYC upgrade verdict.
  [
    'POST',
    '/_control/kyc',
    async (req, res, _u, body) => {
      const customerId = body.customerId ?? [...state.customers.keys()].at(-1);
      if (!customerId) return send(res, 400, { error: 'no_customer' });
      const out = await emit('kyc.approved', {
        customerId,
        newKycLevel: body.newKycLevel ?? 'TIER_2',
      });
      send(res, 200, out);
    },
  ],

  // Raw escape hatch: emit any event verbatim.
  [
    'POST',
    '/_control/emit',
    async (req, res, _u, body) => {
      if (!body.type) return send(res, 400, { error: 'type_required' });
      const out = await emit(body.type, body.data ?? {});
      send(res, 200, out);
    },
  ],
];

// ── Server ─────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';
  const body = method === 'POST' ? await readJson(req) : {};

  for (const [m, path, handler] of controlRoutes) {
    if (m === method && url.pathname === path) {
      try {
        return await handler(req, res, url, body);
      } catch (e) {
        log('control error', e);
        return send(res, 500, { error: String(e) });
      }
    }
  }

  for (const [m, match, handler] of routes) {
    if (m === method && match(url.pathname)) {
      try {
        return await handler(req, res, url, body);
      } catch (e) {
        log('route error', e);
        return send(res, 500, { error: String(e) });
      }
    }
  }

  log(`UNHANDLED ${method} ${url.pathname}`);
  send(res, 404, { error: 'stub_route_not_implemented', method, path: url.pathname });
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT} -> backend ${BACKEND_URL}`);
});
