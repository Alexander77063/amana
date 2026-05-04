import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type BumpDecidedContext = {
  bumpRequestId: string;
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  decision: 'approve_once' | 'approve_raise_limit' | 'deny';
};

export function bumpDecided(ctx: BumpDecidedContext): RenderedNotification {
  const isApproved = ctx.decision !== 'deny';
  return {
    title: isApproved ? 'Bump approved' : 'Bump declined',
    body: isApproved
      ? `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} approved.`
      : `Your request for ${formatNaira(ctx.amountKobo)} at ${ctx.vendorResolvedName} was declined.`,
    data: {
      kind: 'bump_decided',
      bumpRequestId: ctx.bumpRequestId,
      transactionId: ctx.transactionId,
      decision: ctx.decision,
    },
  };
}
