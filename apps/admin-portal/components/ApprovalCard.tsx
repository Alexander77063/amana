'use client';
import { type ReactNode, useState } from 'react';
import { api } from '../lib/api';
import { describeApproval, errorMessage, relativeTime } from '../lib/copy';
import { can } from '../lib/me';
import type { Approval, ApprovalOutcome, ApprovalStatus, Me } from '../lib/types';
import { StatusPill } from './StatusPill';

const decidingPermission = (a: Approval) =>
  a.kind === 'role_grant' ? 'iam.write' : 'vendor.write';

/**
 * The second seat when nobody is sitting in it.
 *
 * Only a *pending* approval is waiting for a person. A decided row can also reach here with an
 * empty seat, because two of the four endings never write a checker at all: the cron sweep expires
 * a proposal nobody got to, and the maker can withdraw their own. Printing "needs a second person"
 * over a closed row would send an operator hunting for a decision they can no longer make.
 */
function emptySeat(status: ApprovalStatus, expiresAt: string): ReactNode {
  if (status === 'pending') {
    return (
      <>
        needs a second person<span className="muted">expires {relativeTime(expiresAt)}</span>
      </>
    );
  }
  if (status === 'expired') return <>expired without a decision</>;
  if (status === 'cancelled') return <>withdrawn by the maker</>;
  // Unreachable today — approve and reject both seat the checker — but kept so a future ending
  // that forgets to record one cannot silently reintroduce the "needs a second person" lie.
  return <>no second person recorded</>;
}

/**
 * One decision, two seats. The maker's seat is filled; the checker's is empty until someone who
 * is allowed to decide sits in it. Nothing else on the page changes when they do.
 */
export function ApprovalCard(props: {
  approval: Approval;
  subjectName?: string;
  me: Me;
  onDecided: () => void;
}) {
  const { approval: a, me } = props;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ApprovalOutcome | 'rejected' | 'cancelled' | null>(null);

  const isMaker = a.makerAdminUserId === me.id;
  const mayDecide = !isMaker && a.status === 'pending' && can(me, decidingPermission(a));
  const checkerEmail = outcome ? me.email : a.checkerEmail;

  const run = async (fn: () => Promise<ApprovalOutcome | 'rejected' | 'cancelled'>) => {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await fn());
      props.onDecided();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card approval">
      <div>
        <div className="what">{describeApproval(a, props.subjectName)}</div>
        {a.kind === 'vendor_approve_claim' &&
        (a.payload as { category: string | null }).category ? (
          <div className="muted">
            Category: {(a.payload as { category: string | null }).category}
          </div>
        ) : null}
        {a.reason ? <div className="muted">“{a.reason}”</div> : null}
        <div className="seats">
          <div className="seat filled">
            proposed by <span className="who">{a.makerEmail}</span>
            <span className="muted">{relativeTime(a.createdAt)}</span>
          </div>
          <div className={`seat${checkerEmail ? ' filled' : ''}`}>
            {checkerEmail ? (
              <>
                decided by <span className="who">{checkerEmail}</span>
              </>
            ) : (
              emptySeat(a.status, a.expiresAt)
            )}
          </div>
        </div>
        {outcome && typeof outcome === 'object' && outcome.kind === 'vendor_approve_claim' ? (
          <div className="banner" style={{ marginTop: 12 }}>
            Read this code to the merchant — it is shown nowhere else:
            <div className="code">{outcome.publicCode}</div>
          </div>
        ) : null}
        {outcome === 'rejected' ? <p className="ok-msg">Declined.</p> : null}
        {outcome === 'cancelled' ? <p className="ok-msg">Withdrawn.</p> : null}
        {a.status !== 'pending' ? (
          <div style={{ marginTop: 8 }}>
            <StatusPill
              tone={a.status === 'approved' ? 'ok' : a.status === 'expired' ? 'warn' : 'bad'}
            >
              {a.status}
            </StatusPill>
            {a.decisionReason ? <span className="muted"> “{a.decisionReason}”</span> : null}
          </div>
        ) : null}
        {error ? <p className="err">{error}</p> : null}
      </div>
      {a.status === 'pending' && !outcome ? (
        <div>
          {mayDecide ? (
            <>
              <label htmlFor={`reason-${a.id}`}>Reason (optional)</label>
              <input
                id={`reason-${a.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api.approvals.approve(a.id, reason || undefined))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.approvals.reject(a.id, reason || undefined);
                      return 'rejected';
                    })
                  }
                >
                  Decline
                </button>
              </div>
            </>
          ) : null}
          {isMaker ? (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.approvals.cancel(a.id);
                  return 'cancelled';
                })
              }
            >
              Withdraw
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
