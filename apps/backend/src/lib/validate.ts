import type { Context } from 'hono';
import type { ZodTypeAny, output } from 'zod';

function reject(c: Context, issues: unknown): Response {
  return c.json({ error: 'validation_error', issues }, 400);
}

/** Parse + validate a JSON request body. Returns a 400 Response on failure. */
export async function parseBody<S extends ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<output<S> | Response> {
  const raw = await c.req.json().catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) return reject(c, result.error.issues);
  return result.data;
}

/** Parse + validate the query string. Returns a 400 Response on failure. */
export function parseQuery<S extends ZodTypeAny>(c: Context, schema: S): output<S> | Response {
  const result = schema.safeParse(c.req.query());
  if (!result.success) return reject(c, result.error.issues);
  return result.data;
}

/** Parse + validate path params. Returns a 400 Response on failure. */
export function parseParams<S extends ZodTypeAny>(c: Context, schema: S): output<S> | Response {
  const result = schema.safeParse(c.req.param());
  if (!result.success) return reject(c, result.error.issues);
  return result.data;
}
