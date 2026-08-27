# Staff onboarding — email templates

Fill in `{{NAME}}`, `{{EMAIL}}` and `{{ROLE}}`; send. Two emails, deliberately, in this order.

---

## ⚠️ One correction to the obvious approach, first

**Do not put a password in an email.** Not a temporary one, not one they will change immediately.
Email is stored, forwarded, backed up and read on shared screens, and a message containing both the
username *and* the password is a complete credential sitting in an inbox forever.

Google Workspace does not require you to. When you create the account, Google can send its **own**
sign-in link that makes the person set a password they choose, which you never see. Use that.

**If your Workspace is configured to hand you a temporary password anyway:** send it on a different
channel from the email address — WhatsApp, SMS, or spoken — so no single compromised medium carries
both halves. That is the whole rule: **never both halves in one place.**

The templates below assume the correct flow — Google sends the credential link, you send the context.

---

## Email 1 — your Elite Solutions Hub account

> **Subject:** Your Elite Solutions Hub account — {{NAME}}
>
> Hi {{NAME}},
>
> Your work account is ready:
>
> **{{EMAIL}}**
>
> Google has sent you a separate email with a link to set your password. Use that link to choose
> your own password — nobody here can see it, and nobody here should ever ask you for it.
>
> **Two things to do when you first sign in:**
>
> 1. **Turn on two-step verification.** Google will prompt you. Please do it then rather than later
>    — this account controls access to systems that handle customers' money.
> 2. **Use this account only for work.** It is how we know it is you, and it is how we remove access
>    if your phone is lost or you move on.
>
> If the password link has expired or did not arrive, reply here and we will send another. **Do not
> ask anyone to send you a password over chat or email** — we will never do that, and anyone who
> does is not us.
>
> Welcome aboard.

---

## Email 2 — your Amana admin access

Sent **after** they have signed into the Workspace account, not before. Access without an
identity to attach it to is the thing this whole system exists to avoid.

> **Subject:** Your Amana admin access — {{ROLE}}
>
> Hi {{NAME}},
>
> You now have access to the Amana admin portal, signed in with your **{{EMAIL}}** account. There is
> no separate password — sign in with Google.
>
> **Your role is `{{ROLE}}`.** It gives you exactly what that role needs and nothing else. If you
> hit something you cannot do and think you should be able to, say so — that is the system working
> as intended, not a bug, and the fix is a deliberate grant rather than a workaround.
>
> **Three things worth knowing before you start:**
>
> 1. **Everything you do is recorded against your name.** Not to catch you out — so that when
>    something is questioned months later, we can show exactly what happened and who did it. That
>    protects you as much as anyone.
> 2. **Some actions need a second person to approve.** Suspending a business, approving a claim, and
>    granting access all need another admin to confirm. Neither of you can do it alone. This is
>    normal and is not a reflection on you.
> 3. **You cannot change your own permissions.** Nobody can, including the person who set this up.
>
> {{#if ROLE == support}}
> **Because you will speak to customers:** you must verify each caller electronically before
> discussing anything. You will not see their personal details — you will see only that they have
> been verified. Their name, account number, BVN and NIN are not visible to you at any point. If a
> caller pressures you to skip verification, that is precisely when not to.
> {{/if}}
>
> The portal is at **{{PORTAL_URL}}**. Ask before sharing that link outside the team.

---

## Offboarding — the other half, and the one people forget

Onboarding is a checklist people follow because someone is waiting. Offboarding is a checklist people
skip because nobody is.

- [ ] **Suspend the Google Workspace account.** This alone kills portal access, because sign-in goes
      through Google. Do it first — it is the single most effective step.
- [ ] **Revoke their Amana role.** Belt and braces, and it makes the audit trail read correctly.
- [ ] **Check for pending approvals they made.** A maker-checked action they proposed should not be
      approved by someone who no longer works here.
- [ ] **Note the date.** Access reviews compare against leaving dates.
