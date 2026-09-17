'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { errorMessage } from '../../../lib/copy';
import { can, useMe } from '../../../lib/me';
import type { StuckTransaction } from '../../../lib/types';

const naira = (kobo: string) =>
  `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const ageOf = (iso: string): string => {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

/**
 * Refusal copy.
 *
 * Checked BEFORE `errorMessage`, which answers any 403 with "You don't have permission for that."
 * That is true but useless here: the operator does have the permission, and what they are missing
 * is a live elevation. A refusal the operator cannot act on is a refusal that gets retried.
 */
function refusalMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'elevation_required':
        return 'That needs a live elevation. Raise one against this transaction and try again.';
      case 'too_early':
        return 'Too early — the automatic sweep still owns this one. Leave it a little longer.';
      case 'still_pending':
        return 'Anchor says this transfer is still in progress, so it is not stuck. Leave it.';
      case 'not_stuck':
        return 'Already resolved — it is no longer in flight. Nothing to do.';
      case 'anchor_unreachable':
        return 'Could not reach Anchor, so nothing was changed. Check Anchor status — do not retry in a loop, because an outage is not the same as a missing record.';
      default:
        return errorMessage(e);
    }
  }
  return errorMessage(e);
}

export default function MoneyPage() {
  const me = useMe();
  const allowed = can(me, 'money.operate');

  const [rows, setRows] = useState<StuckTransaction[]>([]);
  const [elevatingId, setElevatingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const refresh = useCallback(async () => {
    try {
      setRows((await api.money.stuck()).transactions);
    } catch (e) {
      setMsg({ err: refusalMessage(e) });
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
  }, [allowed, refresh]);

  if (!allowed) {
    return (
      <div className="card">
        <h2>Money operations</h2>
        <p>You do not have money operations access.</p>
      </div>
    );
  }

  const raiseElevation = async (id: string) => {
    try {
      await api.money.elevate(id, reason.trim());
      setMsg({
        ok: 'Elevation raised. It covers this transaction only, and expires in 15 minutes.',
      });
      setElevatingId(null);
      setReason('');
    } catch (e) {
      setMsg({ err: refusalMessage(e) });
    }
  };

  const resolveOne = async (id: string, kind: StuckTransaction['kind']) => {
    setMsg({});
    try {
      const out = await api.money.resolve(id);
      const payout = kind === 'redemption';
      setMsg({
        ok:
          out.outcome === 'settled'
            ? payout
              ? 'Anchor had completed it. The retailer has been paid.'
              : 'Anchor had completed it. The transaction is settled and the vendor was paid.'
            : payout
              ? // NOT a refund: the shopper keeps the voucher and the payout is queued to retry.
                'Anchor had not completed it. The payout is marked failed and will be retried — the retailer still needs paying.'
              : 'Anchor had not completed it. The money has been returned to the customer.',
      });
      await refresh();
    } catch (e) {
      setMsg({ err: refusalMessage(e) });
    }
  };

  return (
    <>
      <div className="card">
        <h2>Stuck payments</h2>
        <p className="sub">
          Money that has left an account but has not arrived: a customer&apos;s payment to a vendor,
          or a payout owed to a retailer. The automatic sweep clears almost all of these within
          minutes — anything here is one it gave up on.
        </p>
        <p className="sub">
          The two unwind differently. A customer payment that failed is{' '}
          <strong>returned to the customer</strong>. A retailer payout that failed is{' '}
          <strong>not</strong> — the shopper keeps what they bought and the payout is retried, so it
          means &ldquo;pay this retailer another way&rdquo;.
        </p>
        <p className="sub">
          <strong>Anchor decides the outcome, not you.</strong> Resolving re-asks Anchor what
          happened and applies the answer: settle if it completed, return the money if it did not.
          There is no button to choose.
        </p>
        {msg.ok ? <p className="pill ok">{msg.ok}</p> : null}
        {msg.err ? <p className="pill bad">{msg.err}</p> : null}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stuck for</th>
                <th>What</th>
                <th>Amount</th>
                <th>Going to</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((t) => (
                  <tr key={t.id}>
                    <td>{ageOf(t.createdAt)}</td>
                    <td>{t.kind === 'redemption' ? 'Retailer payout' : 'Customer payment'}</td>
                    <td>{naira(t.amountKobo)}</td>
                    <td>{t.vendorResolvedName ?? '—'}</td>
                    <td>
                      <button type="button" onClick={() => setElevatingId(t.id)}>
                        Elevate
                      </button>{' '}
                      <button type="button" onClick={() => void resolveOne(t.id, t.kind)}>
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>Nothing stuck. This is the normal state.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {elevatingId ? (
        <div className="card">
          <h2>Raise an elevation</h2>
          <p className="sub">
            This covers one transaction, expires in 15 minutes, and can be spent once. The reason is
            recorded against your name.
          </p>
          <label htmlFor="elevation-reason">Why are you doing this?</label>
          <input
            id="elevation-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. customer called, payment stuck since Tuesday"
          />
          <p>
            <button
              type="button"
              disabled={reason.trim().length < 10}
              onClick={() => void raiseElevation(elevatingId)}
            >
              Raise elevation
            </button>{' '}
            <button
              type="button"
              onClick={() => {
                setElevatingId(null);
                setReason('');
              }}
            >
              Cancel
            </button>
          </p>
        </div>
      ) : null}
    </>
  );
}
