'use client';

import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';

type Outcome =
  | { kind: 'ok'; payoutTransactionId: string }
  | { kind: 'pending_payout'; payoutTransactionId: string }
  | { kind: 'error'; message: string };

/**
 * Redeem a voucher a customer is holding.
 *
 * Keyed entry, not a camera. Scanning is the spec's primary path, but a scanner that half-works
 * at a counter is worse than a field that always does — and the code is short enough to read
 * aloud, which is what a retailer falls back to anyway when a screen is cracked or dim. The
 * camera path is the obvious next addition; USSD (spec §6) is a telco integration, not UI.
 */
export default function Redeem() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOutcome(null);
    try {
      const r = await api.retailer.redeem(code.trim());
      // A synchronous payout rejection is NOT a failed redemption: the service was delivered and
      // the customer's money is still held. Saying "failed" would tell the retailer to refuse
      // service they have already given.
      setOutcome(
        r.payoutFailed || r.status === 'FAILED'
          ? { kind: 'pending_payout', payoutTransactionId: r.payoutTransactionId }
          : { kind: 'ok', payoutTransactionId: r.payoutTransactionId },
      );
      setCode('');
    } catch (err) {
      setOutcome({ kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Redeem</h2>
      <p className="sub">Enter the code your customer is showing you.</p>

      <div className="card">
        <form onSubmit={submit}>
          <label htmlFor="code">Voucher code</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoComplete="off"
            style={{ fontSize: 22, letterSpacing: '0.12em' }}
          />
          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy || code.trim().length < 4}>
              {busy ? 'Checking…' : 'Service delivered'}
            </button>
          </div>
        </form>
      </div>

      {outcome?.kind === 'ok' && (
        <div className="banner">
          <strong>Redeemed.</strong> Your payout is on its way to your bank account. Reference{' '}
          <code>{outcome.payoutTransactionId.slice(0, 8)}</code>.
        </div>
      )}
      {outcome?.kind === 'pending_payout' && (
        <div className="banner">
          <strong>Redeemed — payout delayed.</strong> The voucher is used and your customer is
          served. The transfer to your bank did not go through on the first attempt and will be
          retried; the money is still held for you, not returned to the customer.
        </div>
      )}
      {outcome?.kind === 'error' && <div className="banner bad">{outcome.message}</div>}
    </>
  );
}
