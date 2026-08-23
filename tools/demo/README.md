# Amana demo harness

Records a product walkthrough as a single 1080p video showing the principal and agent phones
side by side, driven through the **real app** in a browser against a **live API**.

Also doubles as an integration smoke test. Everything in "What this found" below was
discovered by running these scripts — none of it was visible to the unit suite, because none of
it is a unit-level failure.

---

## What the video is, and what it is not

**It is:** the real Expo apps and the real backend, end to end. No mockups, no edited screens,
no stitched-together stills. A payment in the video is a payment the ledger actually recorded.

**It is not production.** Be precise about this with investors:

- The banking partner is **stubbed locally** (`tools/anchor-stub`). No real money moves, and no
  real Anchor sandbox call is made. The video says so, on every frame, in the header badge.
- These are the **web builds** of the apps, not the native builds. NFC tap-to-pair cannot exist
  in a browser and is not shown — pairing in the video uses the real pairing-code path.
- **Marketplace, digital VAS and retailer KYB have no app UI at all.** They are backend-only.
  They must never appear in app footage; if you want to show them, show them as an API and
  ledger segment, captioned as backend.

Nothing has ever run in production: Anchor is on sandbox, the Termii sender ID is unregistered,
and the live Anchor E2E gate is still open. See `docs/runbook/go-live-checklist.md`.

---

## Running it

Four processes. Each command is its own terminal; ports are hard-coded in the scripts and
overridable by env.

```bash
# 0. Postgres, migrated
docker compose up -d
pnpm --filter @amana/backend db:migrate

# 1. The stubbed banking partner
STUB_PORT=3200 BACKEND_URL=http://localhost:3100 \
ANCHOR_WEBHOOK_SECRET=whsec_demo_local \
node tools/anchor-stub/server.mjs

# 2. The backend, pointed at the stub, with CORS open to the two web apps
NODE_ENV=development PORT=3100 \
DEV_OTP_BYPASS_CODE=123456 \
ANCHOR_API_BASE_URL=http://localhost:3200 ANCHOR_API_KEY=stub-key \
ANCHOR_WEBHOOK_SECRET=whsec_demo_local \
ADMIN_API_KEY=demo-admin-key-000000000000000000 \
CORS_ALLOWED_ORIGINS=http://localhost:19006,http://localhost:19007,http://localhost:19100 \
pnpm --filter @amana/backend dev

# 3. The two apps on web
EXPO_PUBLIC_BACKEND_URL=http://localhost:3100 pnpm --filter @amana/principal exec expo start --web --port 19006
EXPO_PUBLIC_BACKEND_URL=http://localhost:3100 pnpm --filter @amana/agent     exec expo start --web --port 19007

# 4. Record
node tools/demo/record.mjs           # full pacing, ~2.5 min of video
SPEED=4 node tools/demo/record.mjs   # fast, for iterating on the script
```

Output lands in `tools/demo/out/`: the `.webm` video, plus screenshots at each chapter and a
`record-FAIL-*.png` for any step that breaks.

**There is no audio** — Playwright records video only. `NARRATION.md` has a voiceover script
and the `ffmpeg` command to mux it (and to get an `.mp4`, which you want for Keynote/PowerPoint;
`.webm` will not play there).

---

## The scripts

| Script | What it does |
|---|---|
| `record.mjs` | The walkthrough. Drives both apps through iframes on `stage.html`, records 1080p. |
| `stage.html` | The two-phone stage: bezels, brand header, provenance badge, caption bar. |
| `drive.mjs` | Walks the whole product through the **API** — signup → household → funding → pairing → sub-wallet → rules → spend → settle → bump. The engine segment, and the fastest way to check the backend end to end. |
| `lib.mjs` | Shared HTTP + logging helpers for the API scripts. |
| `smoke.mjs` | Do both web apps actually render in a browser, with no console errors? |
| `probe-*.mjs` | Focused probes kept from debugging: malformed ids, agent signup, the spend path, resume-after-bump. |
| `debug-*.mjs` | Throwaway diagnostics (DOM shape, network trace, the render-loop crash). Kept because they are how the bugs were found. |

`tools/anchor-stub/server.mjs` is the stubbed banking partner. It speaks the flat internal
contract the adapter expects and exposes a `/_control/*` plane so a script can fire correctly
**signed** webhooks on cue (`fund`, `settle`, `fail-transfer`, `kyb`, `bill-success`). The
backend reaches it purely through `ANCHOR_API_BASE_URL` — there are **no product code changes**
and no mock branch anywhere in `src/`.

---

## What this found

Running the product end to end surfaced bugs the 852-test suite could not, because they are all
wiring and integration failures rather than unit-level logic errors.

**Money could not move at all from the agent app.** `ConfirmScreen` did
`createIntent → evaluate → navigate('Sending')` and nothing ever called
`POST /transactions/:id/send`; the api-client had no `send` method. Every payment ended in
"Payment failed. Error: UNKNOWN" after the poll gave up. Backend was correct throughout.

**A new agent could not sign up.** The agent app posted only `{phone, code}`, but the server
mints an `agent` only when the request carries a pairing code, so it fell through to the
principal branch and 400'd.

**The sub-wallets screen crashed** with "Maximum update depth exceeded" —
`useSubWalletsStore((s) => Object.values(s.byId))` returns a new array on every call and zustand v5
compares snapshots by identity. Deterministic, and not web-specific: RN 0.74 is React 18 too.

**Its empty state was a dead end** — the "＋ NEW SUB-WALLET" button was only rendered in the
non-empty branch, so a principal who had never made one had no way to make their first.

**The api-client was broken in every browser.** `this.fetchImpl(...)` calls the DOM `fetch` with
the client as receiver, which browsers reject ("Illegal invocation"). This would have blocked
the SP4b retailer portal outright.

**No CORS**, so no browser client could reach the API at all.

**Ten routes 500'd on a malformed id** instead of 400, and `resume-after-bump` 500'd on an
already-used one-shot token — which is just a double-tap on "resume".

---

## Known issues

- **No visible back affordance.** `MainStack` sets `headerShown: false` and no screen draws its
  own back control, so on the Pairing screen (and others) the only way back is the OS gesture.
  The recorder re-navigates the frame instead, which is the browser equivalent. Worth a real
  back button.
- **Sub-wallet balance always reads ₦0.00.** Correct under the limits-only funds model (a
  sub-wallet is an envelope, not an account) but it reads as a bug on screen. Consider showing
  "spent today / daily limit" instead of a balance.
- **Category locks and time windows have no editor.** The engine enforces them; the app only
  exposes the daily limit. The video's caption says exactly that — do not let it imply more.
- **`getByRole` does not find the bottom tabs.** react-navigation's web tab bar exposes no
  tab/button role, so the recorder matches tab labels by text.
- **Web is a demo surface, not a shipping target.** The `*.web.ts` twins trade the Keychain for
  `localStorage` and stub push. If a real web app ever ships, revisit both — start with an
  httpOnly cookie session rather than a token in `localStorage`.
