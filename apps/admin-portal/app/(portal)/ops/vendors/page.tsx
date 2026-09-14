'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, maskPhone, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import {
  type ClaimAttempt,
  SPEND_CATEGORIES,
  type VendorStatus,
  type VendorSummary,
} from '../../../../lib/types';

const tone = (s: VendorStatus) => (s === 'claimed' ? 'ok' : s === 'suspended' ? 'bad' : 'neutral');

export default function VendorsPage() {
  const me = useMe();
  const [queue, setQueue] = useState<ClaimAttempt[]>([]);
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<VendorStatus | ''>('');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      setQueue((await api.vendors.queue()).attempts);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  const search = useCallback(async (s: VendorStatus | '', term: string) => {
    try {
      setVendors((await api.vendors.search(s || undefined, term || undefined)).vendors);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadQueue();
    void search('', '');
  }, [loadQueue, search]);

  const propose = async (a: ClaimAttempt) => {
    setNotes((n) => ({ ...n, [a.id]: '' }));
    try {
      await api.vendors.proposeClaim(a.vendorId, a.phone, categories[a.id] || null);
      setNotes((n) => ({
        ...n,
        [a.id]: 'Proposed. A second ops colleague has to approve it in the inbox.',
      }));
    } catch (e) {
      setNotes((n) => ({ ...n, [a.id]: errorMessage(e) }));
    }
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    void search(status, q);
  };

  return (
    <>
      <h1>Vendors</h1>
      <p className="sub">
        Claims waiting for a phone check, and every business the registry knows about.
      </p>
      {error ? <p className="err">{error}</p> : null}

      <h2>Claims to check</h2>
      {queue.length === 0 ? (
        <p className="muted">
          No open claims. A claim appears here when a merchant starts one from a sticker or a call.
        </p>
      ) : null}
      {queue.map((a) => {
        const name = a.vendor?.displayName ?? 'Unknown vendor';
        return (
          <div className="card" key={a.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{name}</strong>{' '}
                <span className="muted mono">
                  {a.vendor?.bankCode} {a.vendor?.accountNumberMasked}
                </span>
                <div className="muted">
                  claimed by <span className="mono">{maskPhone(a.phone)}</span> · started{' '}
                  {relativeTime(a.createdAt)} · expires {relativeTime(a.expiresAt)}
                </div>
              </div>
              {a.vendor ? (
                <StatusPill tone={tone(a.vendor.status)}>{a.vendor.status}</StatusPill>
              ) : null}
            </div>
            {can(me, 'vendor.write') ? (
              <>
                <label htmlFor={`cat-${a.id}`}>Category for {name}</label>
                <select
                  id={`cat-${a.id}`}
                  value={categories[a.id] ?? ''}
                  onChange={(e) => setCategories((c) => ({ ...c, [a.id]: e.target.value }))}
                >
                  <option value="">No category</option>
                  {SPEND_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="row" style={{ marginTop: 10 }}>
                  <button type="button" onClick={() => propose(a)}>
                    Propose approval for {name}
                  </button>
                  <span className="muted">
                    Hands this account to the caller once a second colleague agrees.
                  </span>
                </div>
                {notes[a.id] ? (
                  <p className={notes[a.id]?.startsWith('Proposed') ? 'ok-msg' : 'err'}>
                    {notes[a.id]}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}

      <h2 style={{ marginTop: 28 }}>Find a vendor</h2>
      <form onSubmit={onSearch} aria-label="Find a vendor" className="card">
        <label htmlFor="q">Search by name or code</label>
        <input
          id="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="CORNER SHOP or AMNV-…"
        />
        <label htmlFor="status">Status</label>
        <select
          id="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as VendorStatus | '')}
        >
          <option value="">Any</option>
          <option value="observed">observed</option>
          <option value="claimed">claimed</option>
          <option value="suspended">suspended</option>
        </select>
        <div style={{ marginTop: 12 }}>
          <button type="submit">Search</button>
        </div>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Account</th>
              <th>Status</th>
              <th>Category</th>
              <th>Code</th>
              <th>Households</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link href={`/ops/vendors/${v.id}`}>{v.displayName}</Link>
                </td>
                <td className="mono">
                  {v.bankCode} {v.accountNumberMasked}
                </td>
                <td>
                  <StatusPill tone={tone(v.status)}>{v.status}</StatusPill>
                </td>
                <td>
                  {v.category ?? '—'}
                  {v.category ? <span className="muted"> ({v.categorySource})</span> : null}
                </td>
                <td className="mono">{v.publicCode ?? '—'}</td>
                <td className="num">{v.promotedHouseholdCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
