import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { parseBody, parseParams } from '../lib/validate';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { supportVerificationService } from '../modules/support';

// Two digits, matching what the push offers. Anything else is a client that has drifted from the
// server, so it is a 400 rather than a silent denial that costs the customer their one attempt.
const RespondBody = z.object({ chosenNumber: z.number().int().min(10).max(99) });
const IdParams = z.object({ id: z.string().uuid() });

/**
 * The customer's half of number matching — the one endpoint the mobile apps call.
 *
 * The verification is identified by id in the path, but the ANSWER is always bound to the
 * authenticated user: `respondFromCustomer` refuses any verification that was not addressed to
 * them. The id alone grants nothing.
 */
export const supportRespondRoute = new Hono<{ Variables: ActorVariables }>()
  .use('/support/*', jwtAuth())

  .post('/support/verifications/:id/respond', async (c) => {
    const actor = c.get('actor') as Actor;
    const params = parseParams(c, IdParams);
    if (params instanceof Response) return params;
    const body = await parseBody(c, RespondBody);
    if (body instanceof Response) return body;

    const outcome = await supportVerificationService.respondFromCustomer(db, {
      verificationId: params.id,
      userId: actor.userId,
      chosenNumber: body.chosenNumber,
    });

    // Always 200, including for `not_found`. A 404 here would let a customer probe which
    // verification ids exist — and a verification id is exactly the thing an attacker who has
    // phoned someone would like to confirm.
    return c.json({ outcome });
  });
