# @amana/principal

The Amana Principal mobile app — Expo SDK 51 + React Native 0.74.5.

## What it does (Sub-plan 6b-2)

Builds on 6b-1 (auth flow). Adds:

- First-time setup of a household + master wallet (placeholder Anchor virtual account; real Anchor wiring lands in Sub-plan 7).
- Pair an agent: issue a one-time pairing code, copy it, share via SMS/WhatsApp out-of-band.
- Members list: see paired agents.
- Sub-wallet CRUD: create (must pick from paired agents), view balance + active rules, suspend/resume/close.
- Edit rules: publish a daily NGN spend limit (more rule kinds in a later slice).

Navigation:
- `HomeDashboard` → `HouseholdSetup` (if no household yet)
- `HomeDashboard` → `Members`, `SubWalletsList`, `Pairing`
- `SubWalletsList` → `CreateSubWallet`, `SubWalletDetail`
- `SubWalletDetail` → `EditRules`

## What it does (Sub-plan 6b-1)

- Phone-OTP login against the v0.0.6a-auth backend.
- Persists tokens via `expo-secure-store`; auto-refreshes the access token on 401 (single-flight).
- Fresh principals sign up by entering NIN + BVN at the Verify step (server stamps `kycTier=1`; tier-2 upgrade lands later).
- Placeholder Home screen with a Log-out button.

## Run locally

```bash
# Terminal 1 — backend
cd ../../apps/backend
docker compose up -d
pnpm db:migrate
pnpm dev

# Terminal 2 — Expo dev server
EXPO_PUBLIC_BACKEND_URL=http://localhost:3000 pnpm start
```

(On Windows PowerShell: `$env:EXPO_PUBLIC_BACKEND_URL='http://localhost:3000'; pnpm start`)

If the device can't reach `localhost`, swap the URL for your LAN IP (`http://192.168.x.x:3000`) and ensure the backend is bound to `0.0.0.0`.

## Architecture

- `App.tsx` — root, wraps `RootNavigator` in `SafeAreaProvider`.
- `src/nav/RootNavigator.tsx` — switches between `AuthStack` and `MainStack` on `auth.status` (`booting | logged_out | logged_in`).
- `src/nav/AuthStack.tsx` — `Phone` → `Verify` screens.
- `src/nav/MainStack.tsx` — 8 screens: `HomeDashboard`, `HouseholdSetup`, `Pairing`, `Members`, `SubWalletsList`, `CreateSubWallet`, `SubWalletDetail`, `EditRules`.
- `src/state/auth.store.ts` — Zustand auth store. `bootstrap()` reads from `secureTokenStore`, validates via `/me`. `requestOtp / verifyOtp / logout` actions.
- `src/state/household.store.ts` — Zustand household store. `bootstrap()` reads `/me/household`; `createHousehold(name)`; `refreshMembers()`.
- `src/state/subwallets.store.ts` — Zustand sub-wallets store keyed by id. `refreshList`, `create`, `refreshOne`, `refreshBalance`, `refreshRules`, `publishRules`, `setStatus`.
- `src/lib/api.ts` — `AmanaApiClient` singleton (bearer header + 401 single-flight refresh).
- `src/lib/secure-token-store.ts` — `TokenStore` impl using `expo-secure-store`.
- `src/screens/{Phone,Verify,Splash,HomeDashboard,HouseholdSetup,Pairing,Members,SubWalletsList,CreateSubWallet,SubWalletDetail,EditRules}Screen.tsx` — screens.

## Tech stack

- React Navigation v7 (native-stack)
- Zustand 5
- react-hook-form + zod
- expo-secure-store (token persistence)
- expo-notifications (registered, not yet wired — Sub-plan 6b-3)

## Testing

Logic tests for the API client live in `packages/api-client/tests/` (vitest). Mobile screens are typecheck-validated only:

```bash
pnpm typecheck
```

Manual smoke: Expo Go or simulator (see Run locally above).
