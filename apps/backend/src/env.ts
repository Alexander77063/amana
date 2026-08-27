import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://amana:amana_dev_only@localhost:5432/amana_dev'),
  SENTRY_DSN: z.string().url().optional(),
  ANCHOR_API_KEY: z.string().min(1).optional(),
  ANCHOR_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Shared ops secret for the admin-only retailer onboarding surface (x-admin-api-key).
  // Min 32 chars: it is a bearer-equivalent static credential with no rotation story yet.
  ADMIN_API_KEY: z.string().min(32, 'ADMIN_API_KEY must be at least 32 chars').optional(),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),
  // Browser clients only. Comma-separated EXACT origins (scheme://host:port) — there is
  // deliberately no wildcard: this is a money API, and `*` plus a bearer token in a browser
  // is how a hostile page reads someone's wallet. Unset (the default) mounts no CORS
  // middleware at all, so the native apps and production are unaffected.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ANCHOR_API_BASE_URL: z.string().url().default('https://api.sandbox.getanchor.co'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  TERMII_API_KEY: z.string().optional(),
  TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),
  TERMII_SENDER_ID: z.string().default('Amana'),
  DEV_OTP_BYPASS_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  // 32-byte hex key for at-rest field encryption (BVN/NIN). In production deliver
  // it via KMS / secrets-manager; a dev fallback is injected outside production.
  FIELD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'FIELD_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  JWT_ISSUER: z.string().default('amana'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PAIRING_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  MEDIA_BUCKET: z.string().min(1).default('amana-media-af-south-1'),
  AWS_REGION: z.string().min(1).default('af-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Rate limiting (in-memory, per-instance) on the auth/pairing surface.
  RATE_LIMIT_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  RATE_LIMIT_OTP_PER_PHONE: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_OTP_PER_IP: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_AUTH_PER_IP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_PAIRING_PER_IP: z.coerce.number().int().positive().default(30),
  // The public vendor landing page (`/v/*`, SP-V3). Deliberately an order of magnitude above the
  // auth limits, and its own constant rather than a reuse of RATE_LIMIT_AUTH_PER_IP, because it is
  // sized for a different job: the code space is 32^10, so this limiter is NOT an enumeration
  // defence — nothing is being guessed. It exists only so a sticker photographed off a shop window
  // cannot be replayed into unbounded load on Postgres.
  //
  // 600 per 15 minutes = 40/min. The key is `clientIp`, and Nigerian carriers CGNAT heavily, so in
  // practice that bucket is shared by every subscriber behind one MTN/Airtel/Glo egress address —
  // not one payer. At the auth surface's 60 a busy market day would 429 real customers standing in
  // real shops, and the failure mode is a JSON error where someone expected a shop. Raise this
  // before lowering it; the cost of a false positive here is a payment that does not happen.
  RATE_LIMIT_VENDOR_PAGE_PER_IP: z.coerce.number().int().positive().default(600),
  // The authenticated vendor reads that each cost one Anchor call — FOUR of them:
  // `/vendors/code/*`, `/vendors/name-enquiry`, `/vendors/phone-lookup` and
  // `/vendors/nqr-decode`. They share ONE middleware instance, so they share one bucket per
  // account: an account cannot spend 4x by rotating between the paths. (`/nqr-decode` was added
  // in `99faccb` — its `nqr` branch runs a name enquiry to confirm the decoded account against
  // NIBSS rather than trust the QR's tag 59. Count the `.use(...)` calls in `routes/vendors.ts`
  // before trusting this list; the enumeration here has drifted from them once already.)
  //
  // Per ACCOUNT, not per IP — Nigerian carriers CGNAT, and a false positive on a payment-path
  // read costs a payment, landing on whichever customer happens to be next through that NAT.
  //
  // It has its own constant because it bounds a different thing from every other limiter here:
  // not logins and not Postgres load, but our spend of a PAID partner call and our share of the
  // one process-global Anchor circuit breaker. It was RATE_LIMIT_AUTH_PER_IP, whose name is a lie
  // on a per-actor key — the number was fine, the name said "IP" and said "auth", and it is the
  // name a future operator will read when deciding whether raising it is safe.
  //
  // A `_PER_ACTOR` suffix rather than `_PER_IP`, deliberately: see `actorOrIpKey`, which falls
  // back to the client IP if the actor is ever absent. That fallback is a degrade path for a
  // broken invariant, not the intended key, and the name should describe the intent.
  RATE_LIMIT_VENDOR_ANCHOR_PER_ACTOR: z.coerce.number().int().positive().default(60),
  // Vendor registry (SP-V1). Enforcement is OFF unless explicitly enabled — the registry ships
  // as a measurement instrument and only becomes a control once shadow data justifies it.
  // Note the inverted transform vs RATE_LIMIT_ENABLED: that one defaults ON (`v !== 'false'`),
  // this one defaults OFF, so only the exact string 'true' switches it on.
  VENDOR_CATEGORY_ENFORCE_DEFAULT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  VENDOR_REGISTRY_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(5),
  // Deliberately above MIN_HOUSEHOLDS: being listed is a weaker claim than being categorised,
  // so a vendor is always promoted before it can be categorised (never in the same sweep).
  VENDOR_REGISTRY_CONSENSUS_MIN_HOUSEHOLDS: z.coerce.number().int().positive().default(8),
  VENDOR_REGISTRY_CONSENSUS_RATIO: z.coerce.number().positive().max(1).default(0.6),
  VENDOR_OBSERVATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  // Categories that may never be DERIVED from observation — only claimed or ops-set. Knowing a
  // vendor is a clinic supports a health inference about every household that pays it.
  VENDOR_SENSITIVE_CATEGORIES: z
    .string()
    .default('pharmacy,clinic,health,alcohol,gambling,religious,legal')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean),
    ),
  // How long a vendor has to enter the OTP that proves they control the claiming phone.
  // Longer than the 5-minute OTP TTL on purpose: a shopkeeper mid-service is not at their phone.
  VENDOR_CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // VENDOR_CLAIM_MAX_HOLD_SECONDS was removed closing PRE-LAUNCH GATE 2. It bounded how long one
  // unproven caller could squat a vendor's single pending slot; a pending attempt is no longer
  // exclusive, so there is no hold to bound. It is deliberately not kept as a no-op: a knob that
  // reads like a security control but controls nothing is worse than no knob. Setting it now is
  // simply ignored (the schema is non-strict), which is the right outcome for a stale deploy.
  // Marketplace (SP1 voucher/redemption ledger core). Additive with safe defaults; the fee is
  // an explicit TBD (pricing pass) kept at 0 so it never double-dips a discounted purchase.
  MARKETPLACE_COMMISSION_BPS: z.coerce.number().int().nonnegative().max(10_000).default(500),
  VOUCHER_TTL_HOURS: z.coerce.number().int().positive().default(168),
  MARKETPLACE_SPEND_FEE_KOBO: z.coerce.number().int().nonnegative().default(0),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const merged: NodeJS.ProcessEnv = { ...source };
  if (merged.NODE_ENV !== 'production' && !merged.JWT_SECRET) {
    merged.JWT_SECRET = 'dev-only-secret-do-not-use-in-prod-please-32+chars';
  }
  if (merged.NODE_ENV !== 'production' && !merged.FIELD_ENCRYPTION_KEY) {
    merged.FIELD_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.DEV_OTP_BYPASS_CODE) {
      throw new Error('DEV_OTP_BYPASS_CODE must not be set in production (universal OTP backdoor)');
    }
    // One env var switches off EVERY limiter at once — the OTP surfaces (an SMS bill and a
    // phone-enumeration oracle), the vendor claim rail, the public vendor page's only protection
    // for Postgres, and the per-account bound on our paid Anchor calls. It exists as a dev/test
    // escape hatch; in production it is a single-character outage.
    if (!parsed.data.RATE_LIMIT_ENABLED) {
      throw new Error(
        'RATE_LIMIT_ENABLED must not be false in production (disables every rate limiter)',
      );
    }
    // Production essentials with no safe default. They're modelled as optional so dev/test
    // boot without them, but in production a missing value boots a broken app that fails
    // dangerously at runtime (webhooks → 503 = lost settlement/top-up events = real money;
    // OTP send → no logins). Fail fast at boot instead, mirroring the JWT_SECRET /
    // FIELD_ENCRYPTION_KEY contract. Deliver via Fly secrets / KMS, never committed.
    const required: Record<string, string | undefined> = {
      ANCHOR_API_KEY: parsed.data.ANCHOR_API_KEY,
      ANCHOR_WEBHOOK_SECRET: parsed.data.ANCHOR_WEBHOOK_SECRET,
      TERMII_API_KEY: parsed.data.TERMII_API_KEY,
      ADMIN_API_KEY: parsed.data.ADMIN_API_KEY,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    }
  }
  return parsed.data;
}

export const env: Env = loadEnv();
