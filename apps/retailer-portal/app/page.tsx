'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorMessage, hasSession, storeSession } from '../lib/api';

/**
 * Portal sign-in.
 *
 * Two steps, because that is what phone OTP is: ask for the code, then prove it. The NIN field
 * only appears when the server says this is a first sign-in — asking every returning owner for
 * their NIN would be both pointless and a little alarming.
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
      // The server asks for a NIN only on a first sign-in; reveal the field exactly then.
      if (reason === 'nin_required') setNeedNin(true);
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
            {needNin && (
              <>
                <label htmlFor="nin">NIN</label>
                <input
                  id="nin"
                  value={nin}
                  onChange={(e) => setNin(e.target.value)}
                  placeholder="11 digits"
                  inputMode="numeric"
                />
                <p className="sub" style={{ marginTop: 6 }}>
                  Needed once, to set up your owner account.
                </p>
              </>
            )}
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
