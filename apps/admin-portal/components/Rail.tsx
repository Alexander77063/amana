'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { can, useMe } from '../lib/me';
import type { Permission } from '../lib/types';

/**
 * The rail is built from permissions, never from role names: a section that would 403 on its first
 * request is not shown at all. The inbox has no requirement because everyone has one — scoped by
 * the backend to the kinds they may decide, plus whatever they proposed themselves.
 */
const NAV: ReadonlyArray<{ href: string; label: string; needs: Permission[] }> = [
  { href: '/', label: 'Inbox', needs: [] },
  { href: '/ops/vendors', label: 'Vendors', needs: ['vendor.read'] },
  { href: '/ops/retailers', label: 'Retailers', needs: ['retailer.read'] },
  { href: '/people', label: 'People', needs: ['iam.read'] },
];

export function Rail({ pendingCount }: { pendingCount: number }) {
  const me = useMe();
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const signOut = async () => {
    try {
      await api.signOut();
    } finally {
      router.replace('/sign-in');
    }
  };
  return (
    <nav className="rail" aria-label="Sections">
      <div className="brand">Amana staff</div>
      {NAV.filter((n) => n.needs.every((p) => can(me, p))).map((n) => (
        <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}>
          {n.label}
          {n.href === '/' && pendingCount > 0 ? (
            <span className="count" aria-label={`${pendingCount} waiting`}>
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ))}
      <div className="person">
        <strong>{me.email}</strong>
        {me.roles.length ? me.roles.join(', ') : 'no role yet'}
        <div style={{ marginTop: 10 }}>
          <button type="button" className="secondary" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
