import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type BumpRequestedContext = {
  bumpRequestId: string;
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  agentDisplayName: string;
};

export function bumpRequested(ctx: BumpRequestedContext): RenderedNotification {
  return {
    title: 'Approve a bump?',
    body: `${ctx.agentDisplayName} wants to spend ${formatNaira(ctx.amountKobo)} at ${ctx.vendorResolvedName}.`,
    data: {
      kind: 'bump_requested',
      bumpRequestId: ctx.bumpRequestId,
      transactionId: ctx.transactionId,
    },
  };
}
