# Google Workspace + OAuth setup for `amana-ng.com`

**Blocks:** sub-plan A1 Task 1 (admin identity). Task 1 can be *built* against a stub, but not
verified against anything real until this is done.

**Who does this:** whoever controls DNS for `amana-ng.com`. It is browser work, not a deploy.

> **Note on the instructions.** Google moves its console UI regularly, so this describes *what you
> need and why*, with the exact values, rather than pixel-level clicks. If a screen does not look
> like this, search for the setting name — the values are what matter.

---

## Before you start

- **You must control DNS for `amana-ng.com`.** Every step below is a DNS record or depends on one.
- **Workspace is paid per user**, billed monthly. Only staff who need an Amana admin identity need a
  seat — a support agent needs one, a contractor who never touches the portal does not.
- **Decide the subdomains now**, because they interact with the HSTS preload gate
  ([go-live-checklist](./go-live-checklist.md) §6):

| Host | For | Notes |
|---|---|---|
| `amana-ng.com` | The apex; Workspace verification lives here | Preload target |
| `pay.amana-ng.com` | Public vendor code page | ⚠️ **Confirm this is available before any code is printed** — the agent scan regex is anchored to it |
| `admin.amana-ng.com` | The admin portal | Inherits HTTPS-only from preload `includeSubDomains` |

---

## Part 1 — Create the Workspace and verify the domain

1. **Sign up** at `workspace.google.com`. Choose a plan (Business Starter is enough to begin; you can
   upgrade). When asked, say you **already own a domain** and enter `amana-ng.com`.

2. **Create the first admin account.** Make this **`david@amana-ng.com`** — it is the seeded bootstrap
   owner in A1's invariant 6, and no endpoint can ever mint another one. Getting it wrong means a
   corrective migration.

3. **Verify domain ownership.** Google gives you a TXT record like:

   ```
   Type: TXT   Host: @   Value: google-site-verification=<token>
   ```

   Add it at your DNS provider, then click verify. Propagation is usually minutes; occasionally an
   hour. **Do not delete this record afterwards** — Google re-checks it, and removing it can suspend
   the Workspace.

4. **Add MX records** so the addresses can receive mail. Google shows the current set during setup —
   use theirs rather than any list you find elsewhere, as they have changed over time.

5. **Turn on 2-Step Verification enforcement** for the organisation (Admin console → Security →
   Authentication). This is the point of choosing SSO: it makes MFA a property of the identity rather
   than something Amana has to build and police.

**Checkpoint:** you can sign in at `mail.google.com` as `david@amana-ng.com`.

---

## Part 2 — Create the OAuth app

This is in **Google Cloud Console** (`console.cloud.google.com`), not the Workspace admin console.
Sign in as the Workspace admin so the project is created **inside your organisation** — that is what
makes step 3's "Internal" option available.

1. **Create a project.** Name it something obvious like `amana-admin-portal`.

2. **Enable the identity APIs.** You only need OpenID Connect sign-in; you do **not** need Gmail,
   Drive or Directory scopes. Fewer scopes is not just tidiness — a token that can read mail is a
   much worse thing to leak than one that can only say who you are.

3. **Configure the OAuth consent screen → choose `Internal`.**

   **This is the single most important choice on the page.** `Internal` means only accounts in your
   Workspace can complete sign-in — Google refuses everyone else before your code runs. `External`
   would let any Google account reach your callback and rely entirely on your own domain check.
   Defence in depth: Google's check, Cloudflare Access, and A1's own domain rule are three
   independent gates, and `Internal` is the cheapest of the three.

4. **Scopes:** `openid`, `email`, `profile`. Nothing else.

5. **Credentials → Create OAuth client ID → Web application.**

   **Authorised redirect URIs** — add both, so local development works without a second client:

   ```
   https://admin.amana-ng.com/api/auth/callback/google
   http://localhost:3400/api/auth/callback/google
   ```

   The exact path depends on the portal's auth library and will be confirmed in Task 1; if it
   differs, the redirect URI is a one-line change in this console.

6. **Copy the Client ID and Client Secret.** These are the two values Task 1 needs.

---

## Part 3 — Hand the values to the backend

Set as Fly secrets, never committed:

```bash
fly secrets set --app amana-api \
  GOOGLE_OAUTH_CLIENT_ID='<client id>' \
  GOOGLE_OAUTH_CLIENT_SECRET='<client secret>' \
  ADMIN_WORKSPACE_DOMAIN='amana-ng.com' \
  ADMIN_BOOTSTRAP_OWNER_EMAIL='david@amana-ng.com'
```

`ADMIN_BOOTSTRAP_OWNER_EMAIL` is invariant 6: the **only** way an `owner` comes into existence. There
is deliberately no endpoint that creates one.

---

## ⚠️ Two things that will bite if skipped

**1. Verify the `hd` claim server-side, not the `hd` parameter.**

Google lets you pass `hd=amana-ng.com` on the authorization request to pre-filter the account chooser.
**That is a UI hint and nothing more** — a caller can remove it. The check that counts is the `hd`
claim inside the *verified* ID token, compared against `ADMIN_WORKSPACE_DOMAIN`, server-side, after
signature validation. Also require `email_verified`. Task 1 does both; this note exists so nobody
later "simplifies" it into trusting the parameter.

**2. `Internal` consent depends on the project living in the organisation.**

If you create the Cloud project under a personal Google account rather than the Workspace org, the
`Internal` option is missing and only `External` is offered. If that happens, the project is in the
wrong place — recreate it signed in as the Workspace admin rather than settling for `External`.

---

## When you are done

You should have: a working `david@amana-ng.com` sign-in, a Cloud project set to **Internal**, and a
client ID and secret. That unblocks A1 Task 1.

Then tick these in [go-live-checklist](./go-live-checklist.md):

- [ ] `amana-ng.com` owned and DNS controlled
- [ ] Workspace verified, 2SV enforced
- [ ] OAuth client created, consent screen **Internal**
- [ ] `pay.amana-ng.com` confirmed available (⚠️ before any vendor code is printed)
- [ ] `admin.amana-ng.com` reserved
