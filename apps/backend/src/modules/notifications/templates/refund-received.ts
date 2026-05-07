import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type RefundReceivedContext = {
  refundTransactionId: string;
  originalTransactionId: string;
  subWalletId: string | null;
  amountKobo: bigint;
  vendorResolvedName: string;
};

export function refundReceived(ctx: RefundReceivedContext): RenderedNotification {
  return {
    title: 'Refund received',
    body: `${formatNaira(ctx.amountKobo)} refunded from ${ctx.vendorResolvedName}.`,
    data: {
      kind: 'refund_received',
      refundTransactionId: ctx.refundTransactionId,
      originalTransactionId: ctx.originalTransactionId,
      subWalletId: ctx.subWalletId,
    },
  };
}
