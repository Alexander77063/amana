import type { Context } from 'hono';
import type { ZodType } from 'zod';

export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<T | Response> {
  const raw = await c.req.json().catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return c.json({ error: 'validation_error', issues: result.error.issues }, 400);
  }
  return result.data;
}
