'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApprovalCard } from '../../components/ApprovalCard';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/copy';
import { can, useMe } from '../../lib/me';
import type { Approval, RoleGrantPayload, VendorClaimPayload } from '../../lib/types';

export default function InboxPage() {
  const me = useMe();
  const [pending, setPending] = useState<Approval[]>([]);
  const [decided, setDecided] = useState<Approval[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, d] = await Promise.all([
        api.approvals.list('pending'),
        api.approvals.list('decided'),
      ]);
      setPending(p.approvals);
      setDecided(d.approvals.slice(0, 20));
      // Name the subjects. Each lookup is gated on the permission that reads that record, and a
      // failed lookup leaves the id-less fallback wording ("this person", "this vendor").
      const all = [...p.approvals, ...d.approvals];
      const next: Record<string, string> = {};
      if (can(me, 'iam.read') && all.some((a) => a.kind === 'role_grant')) {
        try {
          for (const adm of (await api.iam.admins()).admins) next[adm.id] = adm.email;
        } catch {
          /* fallback wording */
        }
      }
      if (can(me, 'vendor.read')) {
        const ids = [
          ...new Set(
            all
              .filter((a) => a.kind === 'vendor_approve_claim')
              .map((a) => (a.payload as VendorClaimPayload).vendorId),
          ),
        ];
        await Promise.all(
          ids.map(async (id) => {
            try {
              next[id] = (await api.vendors.get(id)).vendor.displayName;
            } catch {
              /* fallback */
            }
          }),
        );
      }
      setNames(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  const subjectOf = (a: Approval) =>
    a.kind === 'role_grant'
      ? names[(a.payload as RoleGrantPayload).targetAdminUserId]
      : names[(a.payload as VendorClaimPayload).vendorId];

  const waiting = pending.filter((a) => a.makerAdminUserId !== me.id);
  const mine = pending.filter((a) => a.makerAdminUserId === me.id);

  if (me.permissions.length === 0) {
    return (
      <>
        <h1>Inbox</h1>
        <div className="banner">
          You're signed in, but you have no role yet, so nothing here will work until you do. An
          admin has to grant one and a second admin has to approve it — it takes two people on
          purpose.
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Waiting for a second person</h1>
      <p className="sub">
        Each line is something one colleague proposed and a second must decide. Approving hands out
        access or a bank account; read the line before you sit in the seat.
      </p>
      {error ? <p className="err">{error}</p> : null}
      {waiting.length === 0 ? <p className="muted">Nothing is waiting for you.</p> : null}
      {waiting.map((a) => (
        <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />
      ))}

      <h2 style={{ marginTop: 28 }}>Proposed by you</h2>
      {mine.length === 0 ? <p className="muted">You have no open proposals.</p> : null}
      {mine.map((a) => (
        <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />
      ))}

      <h2 style={{ marginTop: 28 }}>Decided recently</h2>
      {decided.length === 0 ? <p className="muted">No decisions yet.</p> : null}
      {decided.map((a) => (
        <ApprovalCard key={a.id} approval={a} subjectName={subjectOf(a)} me={me} onDecided={load} />
      ))}
    </>
  );
}
