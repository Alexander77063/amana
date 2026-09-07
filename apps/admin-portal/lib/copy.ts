import { ApiError } from './api';
import type { Approval, RoleGrantPayload, VendorClaimPayload } from './types';

/** Wire errors into sentences an operator can act on. Never a stack trace, never a reason a 403 withholds. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Your session has ended. Sign in again.';
    if (e.status === 403) return "You don't have permission for that.";
    if (e.status === 404) return "That record doesn't exist, or isn't yours to see.";
    if (e.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (e.status === 502) return 'Could not reach the Amana API. Try again in a moment.';
    if (e.code === 'validation_error') return 'Check the highlighted fields and try again.';
    if (e.code === 'anchor_unavailable') {
      return 'The bank partner is unavailable. Nothing changed; try again later.';
    }
    switch (e.detail) {
      case 'approval_not_pending':
        return 'Someone already decided this one.';
      case 'approval_expired':
        return 'This request expired before it was decided.';
      case 'not_claimable':
        return 'This vendor can no longer be claimed — it was suspended or claimed since the proposal.';
      case 'wrong_approval_kind':
        return 'This request is not the kind you can decide here.';
    }
    if (e.status === 409)
      return 'That change conflicts with the current state. Refresh and look again.';
  }
  return 'Something went wrong. Try again.';
}

export function maskPhone(phone: string): string {
  // +234 803 123 4567 → +234 803 ••• 4567. Keeps enough to recognise, hides enough to not dial.
  const m = phone.match(/^(\+\d{3})(\d{3})\d+(\d{4})$/);
  return m ? `${m[1]} ${m[2]} ••• ${m[3]}` : phone;
}

export function describeApproval(a: Approval, subjectName?: string): string {
  if (a.kind === 'role_grant') {
    const p = a.payload as RoleGrantPayload;
    const who = subjectName ?? 'this person';
    // owner/admin/ops/auditor take "an"; support takes "a".
    const article = /^[aeiou]/.test(p.role) ? 'an' : 'a';
    return `Make ${who} ${article} ${p.role}`;
  }
  const p = a.payload as VendorClaimPayload;
  const shop = subjectName ?? 'this vendor';
  return `Give ${shop}'s account to ${maskPhone(p.phone)}`;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let text: string;
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) text = unit(Math.round(abs / 60_000), 'minute');
  else if (abs < 86_400_000) text = unit(Math.round(abs / 3_600_000), 'hour');
  else text = unit(Math.round(abs / 86_400_000), 'day');
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
