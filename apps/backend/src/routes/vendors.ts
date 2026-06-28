import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { anchorAdapterSingleton } from '../integrations/anchor';
import { isOk } from '../lib/result';
import { parseBody, parseParams, parseQuery } from '../lib/validate';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { decodeNqr } from '../modules/vendors/nqr-decoder';
import { recentsService } from '../modules/vendors/recents.service';
import { vendorResolutionService } from '../modules/vendors/vendor-resolution.service';

const NameEnquiryQuery = z.object({
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
  subWalletId: z.string().uuid(),
});
const PhoneLookupQuery = z.object({
  phoneNumber: z.string().min(1),
  subWalletId: z.string().uuid(),
});
const StickerParams = z.object({ uuid: z.string().uuid() });
const SubWalletQuery = z.object({ subWalletId: z.string().uuid() });
const NqrDecodeBody = z.object({
  payload: z.string().min(1),
  subWalletId: z.string().uuid(),
});

export const vendorsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/name-enquiry', async (c) => {
    const q = parseQuery(c, NameEnquiryQuery);
    if (q instanceof Response) return q;
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'account',
      bankCode: q.bankCode,
      accountNumber: q.accountNumber,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
  })
  .get('/phone-lookup', async (c) => {
    const q = parseQuery(c, PhoneLookupQuery);
    if (q instanceof Response) return q;
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'phone',
      phoneNumber: q.phoneNumber,
      subWalletId: q.subWalletId,
      now: new Date(),
    });
    if (isOk(result)) return c.json(result.value, 200);
    return c.json(
      { error: result.error.code, detail: 'message' in result.error ? result.error.message : null },
      result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'PARTNER_DOWN' ? 503 : 400,
    );
  })
  .get('/sticker/:uuid', async (c) => {
    const params = parseParams(c, StickerParams);
    if (params instanceof Response) return params;
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    const result = await vendorResolutionService.resolve(db, anchorAdapterSingleton, {
      kind: 'sticker',
      stickerUuid: params.uuid,
      subWalletId: q.subWalletId,
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
    const body = await parseBody(c, NqrDecodeBody);
    if (body instanceof Response) return body;
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
    const q = parseQuery(c, SubWalletQuery);
    if (q instanceof Response) return q;
    const list = await recentsService.listTop10(db, q.subWalletId);
    return c.json({ recents: list }, 200);
  });
