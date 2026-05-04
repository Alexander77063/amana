import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type TxnFailedContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  reason: string | null;
};

export function txnFailed(ctx: TxnFailedContext): RenderedNotification {
  return {
    title: 'Payment failed',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} couldn't be sent${ctx.reason ? `: ${ctx.reason}` : ''}.`,
    data: {
      kind: 'txn_failed',
      transactionId: ctx.transactionId,
      reason: ctx.reason,
    },
  };
}
