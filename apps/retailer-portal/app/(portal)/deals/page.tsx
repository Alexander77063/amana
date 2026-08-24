'use client';

import type { RetailerDeal, RetailerItem } from '@amana/api-client';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatNaira } from '../../../lib/api';

const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function Deals() {
  const [deals, setDeals] = useState<RetailerDeal[]>([]);
  const [items, setItems] = useState<RetailerItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [form, setForm] = useState({
    catalogItemId: '',
    percent: '10',
    amountNaira: '',
    startsAt: toLocalInput(new Date(Date.now() + 60_000)),
    endsAt: toLocalInput(new Date(Date.now() + 7 * 86_400_000)),
  });

  const load = useCallback(async () => {
    try {
      const [d, i] = await Promise.all([api.retailer.listDeals(), api.retailer.listItems()]);
      setDeals(d.deals);
      setItems(i.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.retailer.createDeal({
        // Empty means every item this retailer sells.
        catalogItemId: form.catalogItemId || null,
        // Exactly one of these, never both — the server enforces the same invariant, so sending
        // both would be a 400 rather than a silently ignored field.
        discountBps: mode === 'percent' ? Math.round(Number(form.percent) * 100) : null,
        discountNaira: mode === 'amount' ? form.amountNaira : null,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: 'active' | 'paused' | 'ended') {
    setError(null);
    try {
      await api.retailer.setDealStatus(id, status);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const itemName = (id: string | null) =>
    id ? (items.find((i) => i.id === id)?.name ?? 'Item') : 'All services';

  return (
    <>
      <h2>Deals</h2>
      <p className="sub">Run a markdown for a window of time.</p>

      <div className="card">
        <form onSubmit={create}>
          <label htmlFor="item">Applies to</label>
          <select
            id="item"
            value={form.catalogItemId}
            onChange={(e) => setForm({ ...form, catalogItemId: e.target.value })}
          >
            <option value="">All services</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {formatNaira(i.priceKobo)}
              </option>
            ))}
          </select>

          <label htmlFor="mode">Discount</label>
          <div className="row">
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'percent' | 'amount')}
              style={{ maxWidth: 190 }}
            >
              <option value="percent">Percentage off</option>
              <option value="amount">Fixed amount off</option>
            </select>
            {mode === 'percent' ? (
              <input
                aria-label="Percent off"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
                placeholder="10"
                inputMode="decimal"
                style={{ maxWidth: 130 }}
              />
            ) : (
              <input
                aria-label="Amount off in naira"
                value={form.amountNaira}
                onChange={(e) => setForm({ ...form, amountNaira: e.target.value })}
                placeholder="500.00"
                inputMode="decimal"
                style={{ maxWidth: 160 }}
              />
            )}
          </div>

          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="from">Starts</label>
              <input
                id="from"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="to">Ends</label>
              <input
                id="to"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Starting…' : 'Start deal'}
            </button>
          </div>
        </form>
        {error && <p className="err">{error}</p>}
      </div>

      <div className="card">
        {deals.length === 0 ? (
          <p className="muted">No deals yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Applies to</th>
                  <th>Discount</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id}>
                    <td>{itemName(d.catalogItemId)}</td>
                    <td>
                      {d.discountBps !== null
                        ? `${(d.discountBps / 100).toFixed(d.discountBps % 100 === 0 ? 0 : 2)}%`
                        : formatNaira(d.discountKobo)}
                    </td>
                    <td className="muted">
                      {new Date(d.startsAt).toLocaleDateString()} –{' '}
                      {new Date(d.endsAt).toLocaleDateString()}
                    </td>
                    <td>
                      <span className={`pill ${d.status === 'active' ? 'ok' : ''}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="num">
                      {/* `ended` is terminal: the window is part of what buyers were shown. */}
                      {d.status !== 'ended' && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              void setStatus(d.id, d.status === 'active' ? 'paused' : 'active')
                            }
                          >
                            {d.status === 'active' ? 'Pause' : 'Resume'}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void setStatus(d.id, 'ended')}
                          >
                            End
                          </button>
                        </div>
                      )}
                    </td>
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
