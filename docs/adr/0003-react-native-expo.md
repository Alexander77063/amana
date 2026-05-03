# 3. React Native via Expo for both mobile apps

Date: 2026-05-03
Status: Accepted

## Context

We ship two mobile apps (Principal + Agent), both iOS + Android. Need fast
iteration, OTA updates, and a single team capable of shipping both apps.

## Decision

React Native via Expo (managed workflow + EAS Build). Two Expo projects in the
monorepo (`apps/principal`, `apps/agent`) sharing the `@amana/api-client` and
`@amana/types` packages.

## Alternatives considered

- **Flutter.** Better default UX, but a separate Dart skillset and no type
  sharing with the TS backend.
- **Split native (Kotlin + Swift).** Best UX, double the team forever.
  Rejected at our scale.
- **React Native bare workflow.** Useful if we hit Expo limitations
  (e.g. NFC tag-write before Expo's NFC support catches up). We can eject
  per-app later if forced; not a one-way door.

## Consequences

One TypeScript codebase per app, sharing utilities across both. EAS Build
handles the iOS/Android signing and store-submission painful bits. Cost:
some native modules require Expo config plugins.
