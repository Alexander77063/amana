'use client';
import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { StatusPill } from '../../../components/StatusPill';
import { api } from '../../../lib/api';
import { errorMessage, relativeTime } from '../../../lib/copy';
import { can, useMe } from '../../../lib/me';
import type { AdminSummary } from '../../../lib/types';

export default function PeoplePage() {
  const me = useMe();
  const [admins, setAdmins] = useState<AdminSummary[]>([]);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      setAdmins((await api.iam.admins()).admins);
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const onboard = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    try {
      const created = await api.iam.onboard(email.trim());
      setEmail('');
      setMsg({
        ok: `${created.email} can sign in now, but has no role yet. Open their page to propose one.`,
      });
      await load();
    } catch (err) {
      setMsg({ err: errorMessage(err) });
    }
  };

  return (
    <>
      <h1>People</h1>
      <p className="sub">
        Staff who can sign in. What each person can do comes from their roles, and a role takes two
        admins to give and one to take away.
      </p>
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}
      {msg.err ? <p className="err">{msg.err}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Roles</th>
              <th>Status</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/people/${a.id}`}>{a.email}</Link>
                  {a.provisioningSource === 'config' ? (
                    <span className="muted"> · seeded from config</span>
                  ) : null}
                </td>
                <td>
                  {a.roles.length ? a.roles.join(', ') : <span className="muted">no role yet</span>}
                </td>
                <td>
                  <StatusPill tone={a.status === 'active' ? 'ok' : 'bad'}>{a.status}</StatusPill>
                </td>
                <td className="muted">
                  {a.lastSignedInAt ? relativeTime(a.lastSignedInAt) : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can(me, 'iam.write') ? (
        <form
          onSubmit={onboard}
          className="card"
          style={{ marginTop: 24 }}
          aria-label="Add a person"
        >
          <h2>Add a person</h2>
          <p className="muted">
            They must have an amana-ng.com Google account. They start with no role.
          </p>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@amana-ng.com"
          />
          <div style={{ marginTop: 12 }}>
            <button type="submit">Add person</button>
          </div>
        </form>
      ) : null}
    </>
  );
}
