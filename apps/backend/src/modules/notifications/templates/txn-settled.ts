import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type TxnSettledContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  nibssSessionId: string | null;
};

export function txnSettled(ctx: TxnSettledContext): RenderedNotification {
  return {
    title: 'Payment sent',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} settled.`,
    data: {
      kind: 'txn_settled',
      transactionId: ctx.transactionId,
      nibssSessionId: ctx.nibssSessionId,
    },
  };
}
