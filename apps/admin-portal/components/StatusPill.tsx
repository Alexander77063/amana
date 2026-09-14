import type { ReactNode } from 'react';
import type { RetailerStatus } from '../lib/types';

/** Status is always colour plus a word; the word is the children, the colour is the tone. */
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill${tone === 'neutral' ? '' : ` ${tone}`}`}>{children}</span>;
}

/**
 * Lives here rather than in the retailer screens so the list and the detail page cannot drift into
 * colouring the same status two different ways.
 */
export const retailerTone = (s: RetailerStatus): Tone =>
  s === 'approved' ? 'ok' : s === 'suspended' ? 'bad' : s === 'kyb_pending' ? 'warn' : 'neutral';
