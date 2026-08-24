'use client';

import type { RetailerProfile } from '@amana/api-client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, hasSession, signOut } from '../../lib/api';

const NAV = [
  ['/storefront', 'Storefront'],
  ['/deals', 'Deals'],
  ['/redeem', 'Redeem'],
  ['/orders', 'Orders'],
  ['/earnings', 'Earnings'],
  ['/profile', 'Business & KYB'],
] as const;

/**
 * The signed-in shell.
 *
 * The guard here is a convenience, not a security control — every route it wraps is enforced
 * server-side by ownership. Its job is to send someone with no session to the sign-in page
 * instead of showing them a screen full of failed requests.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [retailer, setRetailer] = useState<RetailerProfile | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await hasSession())) {
        router.replace('/');
        return;
      }
      try {
        const { retailer: r } = await api.retailer.me();
        if (alive) setRetailer(r);
      } catch {
        // A dead or revoked session lands here. Clear it rather than leaving the portal in a
        // state where every request 401s.
        await signOut();
        router.replace('/');
      } finally {
        if (alive) setChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  if (!checked) return <main>Loading…</main>;

  const suspended = retailer?.onboardingStatus === 'suspended';
  const notApproved = retailer && retailer.onboardingStatus !== 'approved';

  return (
    <div className="shell">
      <nav className="nav">
        <h1>AMANA</h1>
        <div className="biz">{retailer?.businessName ?? 'Business'}</div>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
            {label}
          </Link>
        ))}
        <div style={{ marginTop: 22 }}>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await signOut();
              router.replace('/');
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main>
        {suspended && (
          <div className="banner bad">
            <strong>Your business is suspended.</strong> You cannot publish items or run deals. You
            can still redeem vouchers customers have already bought — they paid for those, so you
            must be able to honour them — and those payouts still reach your account.
          </div>
        )}
        {notApproved && !suspended && (
          <div className="banner">
            <strong>Verification not finished.</strong> Complete business verification under
            Business &amp; KYB before you can publish items or take payments.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
