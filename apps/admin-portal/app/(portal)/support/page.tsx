'use client';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { errorMessage } from '../../../lib/copy';
import { can, useMe } from '../../../lib/me';
import type {
  SupportOverview,
  SupportRule,
  SupportStart,
  SupportStatus,
  SupportTransaction,
} from '../../../lib/types';

const naira = (kobo: string) =>
  `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function secondsLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

function Countdown({ until, label }: { until: string | null; label: string }) {
  const [left, setLeft] = useState(() => secondsLeft(until));
  useEffect(() => {
    setLeft(secondsLeft(until));
    const t = setInterval(() => setLeft(secondsLeft(until)), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, '0');
  return (
    <span className="pill warn">
      {label} {m}:{s}
    </span>
  );
}

export default function SupportPage() {
  const me = useMe();
  const [phone, setPhone] = useState('');
  const [started, setStarted] = useState<SupportStart | null>(null);
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [overview, setOverview] = useState<SupportOverview | null>(null);
  const [transactions, setTransactions] = useState<SupportTransaction[]>([]);
  const [rules, setRules] = useState<SupportRule[]>([]);

  const verified = status?.status === 'verified';

  const refreshStatus = useCallback(async (id: string) => {
    try {
      setStatus(await api.support.status(id));
    } catch (e) {
      setMsg({ err: errorMessage(e) });
    }
  }, []);

  // Poll only while the answer can still change. A verified session is refreshed by its own
  // countdown, and a dead verification is not worth a request a second.
  useEffect(() => {
    if (!started || status?.status !== 'pending') return;
    const t = setInterval(() => void refreshStatus(started.verificationId), 2000);
    return () => clearInterval(t);
  }, [started, status?.status, refreshStatus]);

  useEffect(() => {
    if (!started || !verified) return;
    void (async () => {
      try {
        const [o, t, r] = await Promise.all([
          api.support.overview(started.verificationId),
          api.support.transactions(started.verificationId),
          api.support.rules(started.verificationId),
        ]);
        setOverview(o);
        setTransactions(t.transactions);
        setRules(r.rules);
      } catch (e) {
        setMsg({ err: errorMessage(e) });
      }
    })();
  }, [started, verified]);

  const begin = async (e: FormEvent) => {
    e.preventDefault();
    setMsg({});
    // `status` must be cleared too. Without it, `setStarted(res)` commits one render with the NEW
    // verification id and the OLD verified status, the reads fire against a pending row, and the
    // operator gets three 403s that self-correct a beat later.
    setStatus(null);
    setOverview(null);
    setTransactions([]);
    setRules([]);
    setCode('');
    try {
      const res = await api.support.start(phone.trim());
      setStarted(res);
      await refreshStatus(res.verificationId);
    } catch (err) {
      setStarted(null);
      setStatus(null);
      // Say plainly that this is OUR limit. The generic 429 copy ("wait a minute") is wrong here
      // twice: the per-number cap is a day, and an operator told only "too many attempts" will
      // assume the customer did something — which is the confusion the explicit 429 exists to stop.
      setMsg({
        err:
          err instanceof ApiError && err.status === 429
            ? 'Verification limit reached — this is our limit, not the caller’s. Either you have started too many in the past hour, or this number has been tried too many times today.'
            : errorMessage(err),
      });
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!started) return;
    setMsg({});
    try {
      const { outcome } = await api.support.confirmCode(started.verificationId, code.trim());
      setCode('');
      if (outcome !== 'verified') {
        setMsg({ err: `That code did not verify (${outcome}).` });
      }
      await refreshStatus(started.verificationId);
    } catch (err) {
      setMsg({ err: errorMessage(err) });
    }
  };

  if (!can(me, 'support.verify')) {
    return (
      <>
        <h1>Support</h1>
        <p className="sub">You do not have the support role.</p>
      </>
    );
  }

  return (
    <>
      <h1>Support</h1>
      <p className="sub">
        Verify the caller controls the number they gave you, then see what they need help with. You
        will not see their name, BVN or NIN at any point — verification unlocks helping, not
        looking.
      </p>

      {msg.err ? <p className="err">{msg.err}</p> : null}
      {msg.ok ? <p className="ok-msg">{msg.ok}</p> : null}

      <form onSubmit={begin} className="card" aria-label="Start a verification">
        <label htmlFor="phone">The number the caller gives you</label>
        <input
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+2348012345678"
          inputMode="tel"
        />
        <button type="submit">Send verification</button>
      </form>

      {started ? (
        <div className="card">
          <p className="sub">
            Read them this number and ask them to tap it. If they got a text instead, ask them to
            read you the code.
          </p>
          <div className="code" aria-label="Number to read aloud">
            {started.matchNumber}
          </div>

          <p>
            <StatusPillFor status={status?.status ?? 'pending'} />{' '}
            {status?.status === 'pending' ? (
              <Countdown until={status.expiresAt} label="expires in" />
            ) : null}
            {verified ? (
              <Countdown until={status?.sessionExpiresAt ?? null} label="session" />
            ) : null}
          </p>

          {status?.status === 'pending' ? (
            <form onSubmit={submitCode} aria-label="Check the code">
              <label htmlFor="code">Or type the code they read to you</label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
              />
              <button type="submit">Check code</button>
            </form>
          ) : null}

          {status?.status === 'expired' ? (
            <p className="sub">
              Nobody answered before the window closed. Start another verification if they are still
              on the line.
            </p>
          ) : null}
          {status?.status === 'denied' ? (
            <p className="sub">
              That did not verify. If they tapped the wrong number, start another verification —
              there is only one attempt per push.
            </p>
          ) : null}
        </div>
      ) : null}

      {verified ? (
        <>
          <div className="card">
            <h2>Account</h2>
            <p className="sub">
              Showing the masked account, their wallets and their rules. Not showing: name, address,
              date of birth, BVN, NIN, or the full account number.
            </p>
            <p>Account {overview?.maskedAccount ?? '—'}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview?.subWallets.length ? (
                    overview.subWallets.map((w) => (
                      <tr key={w.id}>
                        <td>{w.name}</td>
                        <td>{w.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2}>No sub-wallets.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Recent spend</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Amount</th>
                    <th>Where</th>
                    <th>Status</th>
                    <th>Why it failed</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length ? (
                    transactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.occurredAt).toLocaleString('en-NG')}</td>
                        <td>{naira(t.amountKobo)}</td>
                        <td>{t.vendorName ?? t.category ?? '—'}</td>
                        <td>{t.status}</td>
                        <td>{t.failureReason ?? '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>Nothing yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Rules on their wallets</h2>
            <p className="sub">
              Summaries only. Allowlisted account numbers are counted, never listed.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length ? (
                    rules.map((r) => (
                      <tr key={r.id}>
                        <td>{r.kind}</td>
                        <td>{r.summary}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2}>No active rules.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function StatusPillFor({ status }: { status: string }) {
  const tone = status === 'verified' ? 'ok' : status === 'pending' ? 'warn' : 'bad';
  const label =
    status === 'pending'
      ? 'Waiting for them'
      : status === 'verified'
        ? 'Verified'
        : status === 'expired'
          ? 'Expired'
          : 'Not verified';
  return <span className={`pill ${tone}`}>{label}</span>;
}
