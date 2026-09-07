'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../../components/Confirm';
import { StatusPill } from '../../../../../components/StatusPill';
import { api } from '../../../../../lib/api';
import { errorMessage, maskPhone, relativeTime } from '../../../../../lib/copy';
import { can, useMe } from '../../../../../lib/me';
import {
  type ClaimAttempt,
  type ConsentPurpose,
  type ConsentRow,
  SPEND_CATEGORIES,
  type VendorSummary,
} from '../../../../../lib/types';

const PURPOSES: ReadonlyArray<{ value: ConsentPurpose; label: string }> = [
  { value: 'service_terms', label: 'Service terms' },
  { value: 'lender_introduction', label: 'Lender introduction' },
];

export default function VendorPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [vendor, setVendor] = useState<VendorSummary | null>(null);
  const [attempts, setAttempts] = useState<ClaimAttempt[]>([]);
  const [consents, setConsents] = useState<{
    current: Partial<Record<ConsentPurpose, ConsentRow>>;
    history: ConsentRow[];
  }>({ current: {}, history: [] });
  const [category, setCategory] = useState('');
  const [householdId, setHouseholdId] = useState('');
  const [enforced, setEnforced] = useState<'true' | 'false' | 'null'>('null');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      const v = await api.vendors.get(id);
      setVendor(v.vendor);
      setAttempts(v.claimAttempts);
      setCategory(v.vendor.category ?? '');
      setConsents(await api.vendors.consents(id));
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

  if (!vendor) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const write = can(me, 'vendor.write');

  return (
    <>
      <h1>{vendor.displayName}</h1>
      <p className="sub">
        <span className="mono">
          {vendor.bankCode} {vendor.accountNumberMasked}
        </span>{' '}
        ·{' '}
        <StatusPill
          tone={
            vendor.status === 'claimed' ? 'ok' : vendor.status === 'suspended' ? 'bad' : 'neutral'
          }
        >
          {vendor.status}
        </StatusPill>
        {vendor.publicCode ? (
          <>
            {' '}
            · code <span className="mono">{vendor.publicCode}</span>
          </>
        ) : null}{' '}
        · seen by {vendor.promotedHouseholdCount} households
      </p>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      <div className="card">
        <h2>Category</h2>
        <p className="muted">
          Currently {vendor.category ?? 'none'} ({vendor.categorySource}). A category set here
          outranks what the merchant chose.
        </p>
        {write ? (
          <>
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">No category</option>
              {SPEND_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() =>
                  run(() => api.vendors.setCategory(id, category || null), 'Category saved.')
                }
              >
                Save category
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <h2>Consents</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Purpose</th>
                <th>State</th>
                <th>Version</th>
                <th>Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {PURPOSES.map((p) => {
                const c = consents.current[p.value];
                return (
                  <tr key={p.value}>
                    <td>{p.label}</td>
                    <td>
                      {c ? (
                        <StatusPill tone={c.granted ? 'ok' : 'bad'}>
                          {c.granted ? 'granted' : 'revoked'}
                        </StatusPill>
                      ) : (
                        <span className="muted">never given</span>
                      )}
                    </td>
                    <td className="mono">{c?.termsVersion ?? '—'}</td>
                    <td className="muted">{c ? relativeTime(c.recordedAt) : '—'}</td>
                    <td>
                      {write && c?.granted ? (
                        <Confirm
                          label={`Revoke ${p.label.toLowerCase()}`}
                          confirmLabel="revoke"
                          tone="danger"
                          onConfirm={() =>
                            run(
                              () => api.vendors.revokeConsent(id, p.value),
                              `${p.label} consent revoked.`,
                            )
                          }
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Revoking is immediate and takes one person: withdrawing consent must be as easy as giving
          it.
        </p>
      </div>

      <div className="card">
        <h2>Claim attempts</h2>
        {attempts.length === 0 ? (
          <p className="muted">Nobody has tried to claim this account.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Proof</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{maskPhone(a.phone)}</td>
                    <td>
                      <StatusPill
                        tone={
                          a.status === 'verified'
                            ? 'ok'
                            : a.status === 'pending'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {a.status}
                      </StatusPill>
                    </td>
                    <td>{a.ownershipProof ?? '—'}</td>
                    <td className="muted">{relativeTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {write ? (
        <div className="card">
          <h2>Household enforcement</h2>
          <p className="muted">
            Whether registry categories apply to one household's rules. Inherit follows the global
            default.
          </p>
          <label htmlFor="household">Household id</label>
          <input
            id="household"
            value={householdId}
            onChange={(e) => setHouseholdId(e.target.value)}
            className="mono"
          />
          <label htmlFor="enforced">Enforcement</label>
          <select
            id="enforced"
            value={enforced}
            onChange={(e) => setEnforced(e.target.value as 'true' | 'false' | 'null')}
          >
            <option value="null">Inherit</option>
            <option value="true">Enforce</option>
            <option value="false">Never</option>
          </select>
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              disabled={!householdId}
              onClick={() =>
                run(
                  () =>
                    api.vendors.setEnforcement(
                      householdId,
                      enforced === 'null' ? null : enforced === 'true',
                    ),
                  'Enforcement saved.',
                )
              }
            >
              Save enforcement
            </button>
          </div>
        </div>
      ) : null}

      {write && vendor.status !== 'suspended' ? (
        <div className="card">
          <h2>Suspend</h2>
          <p className="muted">
            Suspending {vendor.displayName} stops new spends to this account at once. It takes one
            person and there is no un-suspend button.
          </p>
          <Confirm
            label={`Suspend ${vendor.displayName}`}
            confirmLabel="suspend"
            tone="danger"
            onConfirm={() => run(() => api.vendors.suspend(id), `${vendor.displayName} suspended.`)}
          />
        </div>
      ) : null}
    </>
  );
}
