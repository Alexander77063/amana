import { Hono } from 'hono';
import { db } from '../db/client';
import { type Actor, type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { type BumpRequestRow, bumpRequestsRepo } from '../modules/bumps/bump-requests.repo';

type StatusFilter = 'pending' | 'history' | 'all';

type SerializedBumpRequest = {
  id: string;
  transactionId: string;
  subWalletId: string;
  requestedByUserId: string;
  amountKobo: string;
  vendorResolvedName: string;
  agentNote: string | null;
  status: BumpRequestRow['status'];
  expiresAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

function toWire(b: BumpRequestRow): SerializedBumpRequest {
  return {
    id: b.id,
    transactionId: b.transactionId,
    subWalletId: b.subWalletId,
    requestedByUserId: b.requestedByUserId,
    amountKobo: b.amountKobo.toString(),
    vendorResolvedName: b.vendorResolvedName,
    agentNote: b.agentNote,
    status: b.status,
    expiresAt: b.expiresAt.toISOString(),
    decidedByUserId: b.decidedByUserId,
    decidedAt: b.decidedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

function parseStatus(raw: string | undefined): StatusFilter | null {
  if (raw === undefined || raw === 'all') return 'all';
  if (raw === 'pending' || raw === 'history') return raw;
  return null;
}

export const meBumpsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/bumps', async (c) => {
    const a = c.get('actor') as Actor;
    if (a.role !== 'principal') {
      return c.json({ error: 'only_principal_can_view' }, 403);
    }
    const status = parseStatus(c.req.query('status'));
    if (status === null) {
      return c.json({ error: 'bad_status' }, 400);
    }
    const now = new Date();
    const r = await bumpRequestsRepo.findForPrincipal(db, { userId: a.userId, now });
    return c.json(
      {
        pending: status === 'history' ? [] : r.pending.map(toWire),
        history: status === 'pending' ? [] : r.history.map(toWire),
      },
      200,
    );
  });
