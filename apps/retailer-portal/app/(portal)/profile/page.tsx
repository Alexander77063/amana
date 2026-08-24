'use client';

import type { RetailerProfile } from '@amana/api-client';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';

const STATUS_COPY: Record<string, { pill: string; text: string }> = {
  applied: {
    pill: 'warn',
    text: 'Submit your business details below to start verification.',
  },
  kyb_pending: {
    pill: 'warn',
    text: 'Verification is with our banking partner. This usually takes a day or two.',
  },
  approved: {
    pill: 'ok',
    text: 'Verified. You can publish services, run deals and take payments.',
  },
  suspended: {
    pill: 'bad',
    text: 'Suspended. You can still redeem vouchers already sold, and those payouts still reach you.',
  },
};

export default function Profile() {
  const [me, setMe] = useState<RetailerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState({ businessName: '', contactPhone: '' });
  const [payout, setPayout] = useState({ payoutBankCode: '', payoutAccountNumber: '' });
  const [kyb, setKyb] = useState({ bvn: '', rcNumber: '', email: '' });

  const load = useCallback(async () => {
    try {
      const { retailer } = await api.retailer.me();
      setMe(retailer);
      setProfile({
        businessName: retailer.businessName,
        contactPhone: retailer.contactPhone ?? '',
      });
      setPayout({
        payoutBankCode: retailer.payoutBankCode,
        payoutAccountNumber: retailer.payoutAccountNumber,
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(ok);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!me) return <p className="muted">Loading…</p>;
  const status = STATUS_COPY[me.onboardingStatus] ?? { pill: '', text: '' };

  return (
    <>
      <h2>Business &amp; verification</h2>
      <p className="sub">Your business details, bank account and KYB status.</p>

      <div className="card">
        <div className="row">
          <span className={`pill ${status.pill}`}>{me.onboardingStatus.replace('_', ' ')}</span>
          <span className="muted">{status.text}</span>
        </div>
      </div>

      <div className="card">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(
              () =>
                api.retailer.updateProfile({
                  businessName: profile.businessName,
                  ...(profile.contactPhone ? { contactPhone: profile.contactPhone } : {}),
                }),
              'Business details saved.',
            );
          }}
        >
          <label htmlFor="bn">Business name</label>
          <input
            id="bn"
            value={profile.businessName}
            onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
          />
          <label htmlFor="cp">Contact phone</label>
          <input
            id="cp"
            value={profile.contactPhone}
            onChange={(e) => setProfile({ ...profile, contactPhone: e.target.value })}
            placeholder="+2348012345678"
            inputMode="tel"
          />
          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy}>
              Save details
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Payout account</h3>
        <p className="sub" style={{ marginBottom: 8 }}>
          Where your redemptions are paid. Amana never holds your money.
        </p>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api.retailer.setPayout(payout), 'Payout account updated.');
          }}
        >
          <div className="row">
            <div style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="bank">Bank code</label>
              <input
                id="bank"
                value={payout.payoutBankCode}
                onChange={(e) => setPayout({ ...payout, payoutBankCode: e.target.value })}
                placeholder="000014"
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="acct">Account number</label>
              <input
                id="acct"
                value={payout.payoutAccountNumber}
                onChange={(e) => setPayout({ ...payout, payoutAccountNumber: e.target.value })}
                placeholder="0123456789"
                inputMode="numeric"
              />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy}>
              Update payout account
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Business verification (KYB)</h3>
        <p className="sub" style={{ marginBottom: 8 }}>
          {me.kybSubmitted
            ? 'Submitted. Re-submitting replaces the details we hold.'
            : 'Required before you can be paid. Verified by our banking partner, not by Amana.'}
        </p>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(
              () =>
                api.retailer.submitKyb({
                  bvn: kyb.bvn,
                  ...(kyb.rcNumber ? { rcNumber: kyb.rcNumber } : {}),
                  ...(kyb.email ? { email: kyb.email } : {}),
                }),
              'Sent for verification.',
            );
          }}
        >
          <label htmlFor="bvn">Owner BVN</label>
          <input
            id="bvn"
            value={kyb.bvn}
            onChange={(e) => setKyb({ ...kyb, bvn: e.target.value })}
            placeholder="11 digits"
            inputMode="numeric"
          />
          <label htmlFor="rc">CAC number (if registered)</label>
          <input
            id="rc"
            value={kyb.rcNumber}
            onChange={(e) => setKyb({ ...kyb, rcNumber: e.target.value })}
            placeholder="RC123456"
          />
          <label htmlFor="email">Business email (optional)</label>
          <input
            id="email"
            type="email"
            value={kyb.email}
            onChange={(e) => setKyb({ ...kyb, email: e.target.value })}
          />
          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={busy || kyb.bvn.length !== 11}>
              {me.kybSubmitted ? 'Re-submit for verification' : 'Submit for verification'}
            </button>
          </div>
        </form>
      </div>

      {note && <div className="banner">{note}</div>}
      {error && <div className="banner bad">{error}</div>}
    </>
  );
}
