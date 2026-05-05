import { Hono } from 'hono';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { isOk } from '../lib/result';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { decodeNqr } from '../modules/vendors/nqr-decoder';
import { recentsService } from '../modules/vendors/recents.service';
import { vendorResolutionService } from '../modules/vendors/vendor-resolution.service';

export const vendorsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/name-enquiry', async (c) => {
    const bankCode = c.req.query('bankCode');
    const accountNumber = c.req.query('accountNumber');
    const subWalletId = c.req.query('subWalletId');
    if (!bankCode || !accountNumber || !subWalletId) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'account',
      bankCode,
      accountNumber,
      subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
  })
  .get('/phone-lookup', async (c) => {
    const phoneNumber = c.req.query('phoneNumber');
    const subWalletId = c.req.query('subWalletId');
    if (!phoneNumber || !subWalletId) return c.json({ error: 'missing_params' }, 400);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'phone',
      phoneNumber,
      subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
  })
  .get('/sticker/:uuid', async (c) => {
    const uuid = c.req.param('uuid');
    const subWalletId = c.req.query('subWalletId');
    if (!subWalletId) return c.json({ error: 'missing_params' }, 400);
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'sticker',
      stickerUuid: uuid,
      subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'STICKER_REVOKED'
          ? 410
          : result.error.code === 'STICKER_UNBOUND'
            ? 409
            : 400;
    return c.json({ error: result.error.code }, status);
  })
  .post('/nqr-decode', async (c) => {
    const body = await c.req.json<{ payload: string; subWalletId: string }>();
    if (!body.payload || !body.subWalletId) return c.json({ error: 'missing_params' }, 400);
    const decoded = decodeNqr(body.payload);
    if (!isOk(decoded)) return c.json({ error: 'BAD_INPUT', detail: decoded.error.message }, 400);
    // Confirm via name enquiry path to get authoritative name + touch recents
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'nqr',
      payload: body.payload,
      subWalletId: body.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json({ error: result.error.code }, 400);
  })
  .get('/recents', async (c) => {
    const subWalletId = c.req.query('subWalletId');
    if (!subWalletId) return c.json({ error: 'missing_params' }, 400);
    const list = await recentsService.listTop10(db, subWalletId);
    return c.json({ recents: list }, 200);
  });
