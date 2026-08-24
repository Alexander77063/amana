'use client';

import type { RetailerEarnings } from '@amana/api-client';
import { useEffect, useState } from 'react';
import { api, errorMessage, formatNaira } from '../../../lib/api';

const payoutPill = (status: string | null) => {
  if (status === 'paid') return <span className="pill ok">paid</span>;
  if (status === 'stuck') return <span className="pill bad">stuck</span>;
  return <span className="pill warn">{status ?? 'pending'}</span>;
};

export default function Earnings() {
  const [data, setData] = useState<RetailerEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.retailer.earnings({ limit: 50 }));
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, []);

  if (error) return <div className="banner bad">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      <h2>Earnings</h2>
      {/*
        Settlement history, not a balance. Amana holds no retailer money — each redemption pays
        out to this business's own bank account — so there is no figure here that could be
        "withdrawn", and showing one would invent a liability that does not exist.
      */}
      <p className="sub">
        What you have earned and what has reached your bank. Amana does not hold your money — every
        redemption pays out to your own account.
      </p>

      <div className="card">
        <div className="stats">
          <div className="stat">
            <div className="k">Paid to your bank</div>
            <div className="v">{formatNaira(data.summary.paidKobo)}</div>
          </div>
          <div className="stat">
            <div className="k">On its way</div>
            <div className="v">{formatNaira(data.summary.pendingKobo)}</div>
          </div>
          <div className="stat">
            <div className="k">Earned in total</div>
            <div className="v">{formatNaira(data.summary.netKobo)}</div>
          </div>
          <div className="stat">
            <div className="k">Vouchers redeemed</div>
            <div className="v">{data.summary.redeemedCount}</div>
          </div>
        </div>
      </div>

      <div className="card">
        {data.history.length === 0 ? (
          <p className="muted">
            No redemptions yet. Earnings appear here once a customer redeems a voucher.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Redeemed</th>
                  <th className="num">Customer paid</th>
                  <th className="num">Commission</th>
                  <th className="num">You earned</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.redemptionId}>
                    <td>
                      <code>{h.code}</code>
                    </td>
                    <td className="muted">
                      {h.redeemedAt ? new Date(h.redeemedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="num">{formatNaira(h.grossKobo)}</td>
                    <td className="num muted">−{formatNaira(h.commissionKobo).slice(1)}</td>
                    <td className="num">{formatNaira(h.netKobo)}</td>
                    <td>{payoutPill(h.payoutStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
