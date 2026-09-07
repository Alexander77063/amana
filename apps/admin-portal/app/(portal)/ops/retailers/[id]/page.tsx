'use client';
import { useParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../../components/Confirm';
import { StatusPill, retailerTone } from '../../../../../components/StatusPill';
import { api } from '../../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../../lib/copy';
import { can, useMe } from '../../../../../lib/me';
import type { Retailer } from '../../../../../lib/types';

export default function RetailerPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Retailer | null>(null);
  const [kyb, setKyb] = useState({ bvn: '', rcNumber: '', email: '' });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      setR(await api.retailers.get(id));
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg({});
    try {
      await fn();
      setMsg({ ok });
      await load();
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  };
  const submitKyb = (e: FormEvent) => {
    e.preventDefault();
    const input: { bvn: string; rcNumber?: string; email?: string } = { bvn: kyb.bvn };
    if (kyb.rcNumber) input.rcNumber = kyb.rcNumber;
    if (kyb.email) input.email = kyb.email;
    void run(async () => {
      await api.retailers.kyb(id, input);
      setKyb({ bvn: '', rcNumber: '', email: '' });
    }, 'KYB submitted to the bank partner. The status moves to approved when they confirm.');
  };

  if (!r) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const write = can(me, 'retailer.write');
  const s = r.onboardingStatus;

  return (
    <>
      <h1>{r.businessName}</h1>
      <p className="sub">
        <StatusPill tone={retailerTone(s)}>{s}</StatusPill> · payout{' '}
        <span className="mono">
          {r.payoutBankCode} ••••{r.payoutAccountNumber.slice(-4)}
        </span>
        {r.anchorBusinessCustomerId ? (
          <>
            {' '}
            · bank customer <span className="mono">{r.anchorBusinessCustomerId}</span>
          </>
        ) : null}
        {r.approvedAt ? <> · approved {relativeTime(r.approvedAt)}</> : null}
      </p>
      {s === 'suspended' ? (
        <div className="banner bad">
          {r.approvedAt ? (
            <>
              <strong>Suspended.</strong> This business cannot list items or run deals. It can still
              redeem vouchers already sold — customers paid for those — and those payouts still
              reach it. There is no un-suspend: a suspended retailer re-applies and goes through KYB
              again.
            </>
          ) : (
            <>
              <strong>Suspended, and never approved.</strong> This business failed or abandoned KYB,
              so it has no verified payout account. It cannot list items, run deals, or redeem
              anything — redemption pays money out, and there is nowhere to pay it. There is no
              un-suspend: it re-applies and goes through KYB again.
            </>
          )}
        </div>
      ) : null}
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      {write && (s === 'applied' || s === 'kyb_pending') ? (
        <form onSubmit={submitKyb} aria-label="Submit KYB" className="card">
          <h2>Submit KYB</h2>
          <p className="muted">
            Sent to the bank partner. The BVN is not stored by Amana and is not shown again.
          </p>
          <label htmlFor="bvn">Owner BVN</label>
          <input
            id="bvn"
            value={kyb.bvn}
            onChange={(e) => setKyb({ ...kyb, bvn: e.target.value })}
            required
            pattern="\d{11}"
            inputMode="numeric"
            autoComplete="off"
          />
          <label htmlFor="rcNumber">RC number (optional)</label>
          <input
            id="rcNumber"
            value={kyb.rcNumber}
            onChange={(e) => setKyb({ ...kyb, rcNumber: e.target.value })}
            maxLength={50}
          />
          <label htmlFor="email">Business email (optional)</label>
          <input
            id="email"
            type="email"
            value={kyb.email}
            onChange={(e) => setKyb({ ...kyb, email: e.target.value })}
          />
          <div style={{ marginTop: 12 }}>
            <button type="submit">Submit KYB</button>
          </div>
        </form>
      ) : null}

      {write && (s === 'applied' || s === 'kyb_pending') ? (
        <div className="card">
          <h2>Approve without KYB</h2>
          <p className="muted">
            An ops override. The business goes live now and can take orders; use it only when KYB
            has been checked another way.
          </p>
          <Confirm
            label="Approve without KYB"
            confirmLabel="approve"
            onConfirm={() => run(() => api.retailers.approve(id), `${r.businessName} approved.`)}
          />
        </div>
      ) : null}

      {write && s !== 'suspended' ? (
        <div className="card">
          <h2>Suspend</h2>
          <p className="muted">
            Stops new listings, deals and purchases at once. Vouchers already sold stay redeemable.
            One person, immediate, no undo.
          </p>
          <Confirm
            label={`Suspend ${r.businessName}`}
            confirmLabel="suspend"
            tone="danger"
            onConfirm={() => run(() => api.retailers.suspend(id), `${r.businessName} suspended.`)}
          />
        </div>
      ) : null}
    </>
  );
}
