'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorMessage, hasSession, storeSession } from '../lib/api';

/**
 * Portal sign-in.
 *
 * Two steps, because that is what phone OTP is: ask for the code, then prove it.
 *
 * The NIN box sits on the second step from the start, marked first-sign-in-only, rather than
 * appearing after the server asks for it. It has to: the server cannot know a NIN is needed until
 * it has verified the code, and verifying CONSUMES the code — so discovering the requirement the
 * obvious way leaves the owner holding a spent OTP. Offering the field up front makes the common
 * path one round trip and leaves `nin_required` as a rare fallback that asks for a fresh code.
 */
export default function SignIn() {
  const router = useRouter();
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [nin, setNin] = useState('');
  const [needNin, setNeedNin] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hasSession().then((yes) => {
      if (yes) router.replace('/storefront');
    });
  }, [router]);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.retailerAuth.requestOtp(phone);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api.retailerAuth.verifyOtp({
        phone,
        code,
        ...(nin ? { nin } : {}),
      });
      await storeSession(session, phone);
      router.replace('/storefront');
    } catch (err) {
      const reason = (err as { body?: { error?: string } } | undefined)?.body?.error;
      if (reason === 'nin_required') {
        // The server verifies the code BEFORE it can know whether a NIN is needed, and verifying
        // consumes it — so this code is now spent and cannot be retried. Send them back to
        // request a fresh one, with the NIN field already in front of them.
        setNeedNin(true);
        setSent(false);
        setCode('');
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <h2>Amana for Business</h2>
      <p className="sub">Sign in with the phone number your business is registered to.</p>

      <div className="card">
        {!sent ? (
          <form onSubmit={requestCode}>
            <label htmlFor="phone">Phone number</label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2348012345678"
              inputMode="tel"
              autoComplete="tel"
            />
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy || phone.length < 8}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label htmlFor="code">Six-digit code</label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <label htmlFor="nin">NIN — first sign-in only</label>
            <input
              id="nin"
              value={nin}
              onChange={(e) => setNin(e.target.value)}
              placeholder="11 digits"
              inputMode="numeric"
            />
            <p className="sub" style={{ marginTop: 6 }}>
              {needNin
                ? 'Your code was used up. Enter your NIN, then request a new code.'
                : 'Leave blank if you have signed in before.'}
            </p>
            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy || code.length < 4}>
                {busy ? 'Checking…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSent(false);
                  setCode('');
                  setError(null);
                }}
              >
                Use a different number
              </button>
            </div>
          </form>
        )}
        {error && <p className="err">{error}</p>}
      </div>
    </main>
  );
}
