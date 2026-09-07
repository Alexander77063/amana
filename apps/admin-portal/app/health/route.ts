/** Fly's health check. Static on purpose — a portal that can render is a portal that is up. */
export const dynamic = 'force-dynamic';
export function GET(): Response {
  return Response.json({ status: 'ok' });
}
