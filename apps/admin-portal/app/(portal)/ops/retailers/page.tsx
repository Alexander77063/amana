'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill, retailerTone } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import type { Retailer, RetailerStatus } from '../../../../lib/types';

const STATUSES: RetailerStatus[] = ['applied', 'kyb_pending', 'approved', 'suspended'];

export default function RetailersPage() {
  const me = useMe();
  const [status, setStatus] = useState<RetailerStatus>('applied');
  const [rows, setRows] = useState<Retailer[]>([]);
  const [form, setForm] = useState({
    businessName: '',
    payoutBankCode: '',
    payoutAccountNumber: '',
  });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async (s: RetailerStatus) => {
    try {
      setRows(await api.retailers.list(s));
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    void load(status);
  }, [load, status]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    try {
      await api.retailers.create(form);
      setForm({ businessName: '', payoutBankCode: '', payoutAccountNumber: '' });
      setMsg({ ok: 'Added. Next: submit their KYB from their page.' });
      setStatus('applied');
      await load('applied');
    } catch (err) {
      setMsg({ err: errorMessage(err) });
    }
  };

  return (
    <>
      <h1>Retailers</h1>
      <p className="sub">
        Businesses selling on the marketplace. Only approved retailers can list items or take
        orders.
      </p>
      <div className="row" role="tablist" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === status}
            className={s === status ? undefined : 'secondary'}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Payout account</th>
              <th>Status</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No retailers with status {status}.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/ops/retailers/${r.id}`}>{r.businessName}</Link>
                </td>
                <td className="mono">
                  {r.payoutBankCode} ••••{r.payoutAccountNumber.slice(-4)}
                </td>
                <td>
                  <StatusPill tone={retailerTone(r.onboardingStatus)}>
                    {r.onboardingStatus}
                  </StatusPill>
                </td>
                <td className="muted">{relativeTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {can(me, 'retailer.write') ? (
        <form
          onSubmit={create}
          aria-label="Add a retailer"
          className="card"
          style={{ marginTop: 24 }}
        >
          <h2>Add a retailer</h2>
          <label htmlFor="businessName">Business name</label>
          <input
            id="businessName"
            value={form.businessName}
            onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            required
            maxLength={200}
          />
          <label htmlFor="payoutBankCode">Payout bank code</label>
          <input
            id="payoutBankCode"
            value={form.payoutBankCode}
            onChange={(e) => setForm({ ...form, payoutBankCode: e.target.value })}
            required
            pattern="\d{3,6}"
            inputMode="numeric"
          />
          <label htmlFor="payoutAccountNumber">Payout account number</label>
          <input
            id="payoutAccountNumber"
            value={form.payoutAccountNumber}
            onChange={(e) => setForm({ ...form, payoutAccountNumber: e.target.value })}
            required
            pattern="\d{10}"
            inputMode="numeric"
          />
          <div style={{ marginTop: 12 }}>
            <button type="submit">Add retailer</button>
          </div>
        </form>
      ) : null}
    </>
  );
}
