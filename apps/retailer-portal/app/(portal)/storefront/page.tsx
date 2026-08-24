'use client';

import type { RetailerItem } from '@amana/api-client';
import { SPEND_CATEGORIES } from '@amana/types';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage, formatNaira } from '../../../lib/api';

export default function Storefront() {
  const [items, setItems] = useState<RetailerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: '',
    priceNaira: '',
    section: '',
    category: 'other',
    description: '',
    durationMinutes: '',
  });

  const load = useCallback(async () => {
    try {
      const { items: rows } = await api.retailer.listItems();
      setItems(rows);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
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
      await api.retailer.createItem({
        name: form.name,
        // Sent as a decimal naira string; the server converts to kobo once, at the edge. No
        // float ever touches a price.
        priceNaira: form.priceNaira,
        section: form.section,
        // Distinct from `section`: this is the closed vocabulary a parent's spending lock is
        // matched against, so it decides whether a locked sub-wallet may buy this at all.
        category: form.category,
        description: form.description || null,
        durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      });
      setForm({
        name: '',
        priceNaira: '',
        section: '',
        category: 'other',
        description: '',
        durationMinutes: '',
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: RetailerItem) {
    setError(null);
    try {
      await api.retailer.updateItem(item.id, {
        status: item.status === 'active' ? 'inactive' : 'active',
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h2>Storefront</h2>
      <p className="sub">The services customers can buy from you.</p>

      <div className="card">
        <form onSubmit={create}>
          <label htmlFor="name">Service name</label>
          <input
            id="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Wash and set"
          />
          <div className="row">
            <div style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="price">Price (₦)</label>
              <input
                id="price"
                value={form.priceNaira}
                onChange={(e) => setForm({ ...form, priceNaira: e.target.value })}
                placeholder="4820.00"
                inputMode="decimal"
              />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="section">Section</label>
              <input
                id="section"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value })}
                placeholder="hair"
              />
            </div>
            <div style={{ flex: 1, minWidth: 170 }}>
              <label htmlFor="cat">Spending category</label>
              <select
                id="cat"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {SPEND_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label htmlFor="dur">Takes (minutes, optional)</label>
              <input
                id="dur"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                placeholder="45"
                inputMode="numeric"
              />
            </div>
          </div>
          <label htmlFor="desc">Description (optional)</label>
          <input
            id="desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div style={{ marginTop: 16 }}>
            <button
              type="submit"
              disabled={busy || !form.name || !form.priceNaira || !form.section}
            >
              {busy ? 'Adding…' : 'Add service'}
            </button>
          </div>
        </form>
        {error && <p className="err">{error}</p>}
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">Nothing on your storefront yet. Add your first service above.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Section</th>
                  <th>Category</th>
                  <th className="num">Price</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="muted">{i.section}</td>
                    <td className="muted">
                      {SPEND_CATEGORIES.find((c) => c.value === i.category)?.label ?? i.category}
                    </td>
                    <td className="num">{formatNaira(i.priceKobo)}</td>
                    <td>
                      <span className={`pill ${i.status === 'active' ? 'ok' : ''}`}>
                        {i.status}
                      </span>
                    </td>
                    <td className="num">
                      <button type="button" className="secondary" onClick={() => void toggle(i)}>
                        {i.status === 'active' ? 'Take off sale' : 'Put on sale'}
                      </button>
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
