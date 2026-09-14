'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { signInHref } from '../../lib/api';

/**
 * Split out because `useSearchParams` opts a statically prerendered page into client-side
 * rendering, which Next 14 requires to sit behind a Suspense boundary. Only the failure banner
 * depends on the query, so only the banner waits — the sign-in link is in the static shell and is
 * there the instant the page paints.
 */
function SignInFailure() {
  if (useSearchParams().get('error') !== 'sign_in_failed') return null;
  return (
    <div className="banner bad">
      Sign-in didn't complete. Try again with your amana-ng.com account. If it keeps failing, an
      admin has to check that your access has been set up.
    </div>
  );
}

export default function SignInPage() {
  return (
    <main className="center">
      <h1>Amana staff</h1>
      <p className="sub">
        Sign in with your amana-ng.com Google account. Nothing else is accepted.
      </p>
      <Suspense fallback={null}>
        <SignInFailure />
      </Suspense>
      {/*
        The anchor is the control: a full page navigation, because the backend answers
        /admin/auth/start with a redirect to Google. A <button> nested inside would take the
        accessible name off the link.
      */}
      <a href={signInHref} className="button-link">
        Sign in with Google
      </a>
    </main>
  );
}
