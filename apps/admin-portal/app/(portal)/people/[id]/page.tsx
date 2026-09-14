'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Confirm } from '../../../../components/Confirm';
import { StatusPill } from '../../../../components/StatusPill';
import { api } from '../../../../lib/api';
import { errorMessage, relativeTime } from '../../../../lib/copy';
import { can, useMe } from '../../../../lib/me';
import { type AdminSummary, ROLES, type Role, type RoleGrant } from '../../../../lib/types';

export default function PersonPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const [person, setPerson] = useState<AdminSummary | null>(null);
  const [grants, setGrants] = useState<RoleGrant[]>([]);
  const [role, setRole] = useState<Role | ''>('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      const [{ admins }, g] = await Promise.all([api.iam.admins(), api.iam.grants(id)]);
      setPerson(admins.find((a) => a.id === id) ?? null);
      setGrants(g.grants);
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const propose = async () => {
    if (!role) return;
    setMsg({});
    try {
      const res = await api.iam.grant(id, role, reason || undefined);
      setRole('');
      setReason('');
      setMsg({
        ok:
          res.status === 'approved'
            ? 'Applied at once — the seeded bootstrap account is exempt from the second approval until it is stood down.'
            : 'Proposed. A second admin has to approve it in the inbox.',
      });
      await load();
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  };
  const revoke = async (r: Role) => {
    setMsg({});
    try {
      await api.iam.revoke(id, r, undefined);
      setMsg({ ok: `${r} revoked. It took effect immediately.` });
      await load();
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  };

  if (!person) return <p className="muted">{msg.err ?? 'Loading…'}</p>;
  const self = person.id === me.id;
  const write = can(me, 'iam.write') && !self;

  return (
    <>
      <h1>{person.email}</h1>
      <p className="sub">
        <StatusPill tone={person.status === 'active' ? 'ok' : 'bad'}>{person.status}</StatusPill> ·{' '}
        {person.roles.length ? person.roles.join(', ') : 'no role yet'}
        {person.provisioningSource === 'config' ? ' · seeded from config (break-glass)' : null} ·
        last sign-in {person.lastSignedInAt ? relativeTime(person.lastSignedInAt) : 'never'}
      </p>
      {self ? (
        <div className="banner">
          You can't change your own roles. That is invariant 1: nobody can, so the admin role cannot
          quietly become every other role.
        </div>
      ) : null}
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}

      {write ? (
        <div className="card">
          <h2>Add a role</h2>
          <p className="muted">
            Takes two admins: you propose, a different admin approves in the inbox. Nobody may hold
            both admin and owner.
          </p>
          <label htmlFor="role">Role to add</label>
          <select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="">Choose a role</option>
            {ROLES.filter((r) => !person.roles.includes(r)).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label htmlFor="reason">Why</label>
          <input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div style={{ marginTop: 12 }}>
            <button type="button" disabled={!role} onClick={propose}>
              Propose
            </button>
          </div>
        </div>
      ) : null}

      {write && person.roles.length ? (
        <div className="card">
          <h2>Remove a role</h2>
          <p className="muted">
            Immediate, one person. Removing access must never wait for a quorum.
          </p>
          <div className="row">
            {person.roles.map((r) => (
              <Confirm
                key={r}
                label={`Revoke ${r}`}
                confirmLabel="revoke"
                tone="danger"
                onConfirm={() => revoke(r)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>History</h2>
        {grants.length === 0 ? (
          <p className="muted">No role has ever been granted or revoked.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>By</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {grants
                  .slice()
                  .reverse()
                  .map((g, i) => (
                    <tr key={`${g.recordedAt}-${i}`}>
                      <td className="muted">{relativeTime(g.recordedAt)}</td>
                      <td>
                        {g.granted ? 'granted' : 'revoked'} <strong>{g.role}</strong>
                      </td>
                      <td className="mono">
                        {g.source === 'config' ? 'config seed' : (g.grantedByAdminUserId ?? '—')}
                      </td>
                      <td className="muted">{g.reason ?? '—'}</td>
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
