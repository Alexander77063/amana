'use client';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Rail } from '../../components/Rail';
import { ApiError, api } from '../../lib/api';
import { MeProvider } from '../../lib/me';
import type { Me } from '../../lib/types';

/**
 * The signed-in shell. The guard is a convenience — every route it wraps is enforced by the
 * backend on every request. Its job is to send someone without a session to sign-in instead of
 * showing a page of failed requests, and to keep the person and their inbox count on screen.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      setPending((await api.approvals.list('pending')).approvals.length);
    } catch {
      /* the count is decoration; the inbox itself reports its own failures */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const m = await api.me();
        if (!alive) return;
        setMe(m);
        void refreshCount();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace('/sign-in');
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, refreshCount]);

  if (!me) return <main className="center muted">Loading…</main>;
  return (
    <MeProvider me={me}>
      <div className="shell">
        <Rail pendingCount={pending} />
        <main>{children}</main>
      </div>
    </MeProvider>
  );
}
