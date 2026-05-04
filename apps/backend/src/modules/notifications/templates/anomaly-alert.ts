import { formatNaira } from '../../../lib/kobo';
import type { RenderedNotification } from '../types';

export type AnomalyAlertContext = {
  transactionId: string;
  amountKobo: bigint;
  vendorResolvedName: string;
  anomalyScore: number;
};

export function anomalyAlert(ctx: AnomalyAlertContext): RenderedNotification {
  const pct = Math.round(ctx.anomalyScore * 100);
  return {
    title: 'Unusual transaction flagged',
    body: `${formatNaira(ctx.amountKobo)} to ${ctx.vendorResolvedName} scored ${pct}/100 for unusual pattern.`,
    data: {
      kind: 'anomaly_alert',
      transactionId: ctx.transactionId,
      anomalyScore: ctx.anomalyScore,
    },
  };
}
