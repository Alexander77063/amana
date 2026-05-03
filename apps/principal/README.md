# @amana/principal

Amana Principal mobile app (React Native via Expo).

## Run locally

In one terminal start the backend:

```bash
pnpm --filter @amana/backend dev
```

In another terminal:

```bash
pnpm --filter @amana/principal start
```

Press `a` (Android emulator), `i` (iOS simulator), or `w` (web) inside the Expo CLI prompt.

The bootstrap screen calls `GET /health` against the backend; you should see
"OK · backend version 0.0.0" within a second.
