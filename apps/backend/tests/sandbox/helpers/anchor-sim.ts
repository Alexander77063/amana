import { createHmac } from 'node:crypto';

const BASE_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export async function simulateWebhook(event: {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
}): Promise<{ status: number; body: unknown }> {
  const secret = process.env.ANCHOR_WEBHOOK_SECRET;
  if (!secret) throw new Error('ANCHOR_WEBHOOK_SECRET must be set to simulate webhooks');

  const raw = JSON.stringify(event);
  const sig = createHmac('sha256', secret).update(raw).digest('hex');

  const res = await fetch(`${BASE_URL}/webhooks/anchor`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-anchor-signature': sig,
    },
    body: raw,
  });

  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
