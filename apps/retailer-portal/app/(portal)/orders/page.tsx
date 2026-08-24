'use client';

import type { RetailerRedemption } from '@amana/api-client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatNaira } from '../../../lib/api';

const PAGE = 25;

export default function Orders() {
  const [rows, setRows] = useState<RetailerRedemption[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [end, setEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: number) => {
    setLoading(true);
    try {
      const { redemptions } = await api.retailer.listRedemptions({ limit: PAGE, offset: from });
      setRows((prev) => (from === 0 ? redemptions : [...prev, ...redemptions]));
      // A short page means the end. Cheaper and less racy than asking for a total that changes
      // between requests anyway.
      setEnd(redemptions.length < PAGE);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <>
      <h2>Orders</h2>
      <p className="sub">Every voucher bought from you, newest first.</p>
      {error && <div className="banner bad">{error}</div>}

      <div className="card">
        {rows.length === 0 && !loading ? (
          <p className="muted">No orders yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Bought</th>
                  <th className="num">Paid</th>
                  <th>Status</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td className="muted">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="num">{formatNaira(r.discountedKobo)}</td>
                    <td>
                      <span className={`pill ${r.status === 'redeemed' ? 'ok' : ''}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="muted">{r.payoutStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!end && rows.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="secondary"
              disabled={loading}
              onClick={() => {
                const next = offset + PAGE;
                setOffset(next);
                void load(next);
              }}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
