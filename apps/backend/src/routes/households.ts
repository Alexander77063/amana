import { Hono } from 'hono';
import { db } from '../db/client';
import { placeholderAnchorAccountForHousehold } from '../lib/placeholder-anchor';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { subwalletSnoozeRepo } from '../modules/notifications/subwallet-snooze.repo';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

export const householdsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .post('/', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const body = await c.req.json<{ name: string }>();
    if (!body.name || body.name.trim().length === 0) {
      return c.json({ error: 'name_required' }, 400);
    }
    const existing = await householdsRepo.findByPrincipal(db, a.userId);
    if (existing) return c.json({ error: 'household_exists', householdId: existing.id }, 409);

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as typeof db;
      const hh = await householdsRepo.insert(txDb, {
        principalUserId: a.userId,
        name: body.name.trim(),
      });
      const anchor = placeholderAnchorAccountForHousehold(hh.id);
      const provisioned = await masterWalletsRepo.provision(txDb, {
        householdId: hh.id,
        anchorVirtualAccount: anchor.anchorVirtualAccount,
        anchorBankCode: anchor.anchorBankCode,
        anchorAccountId: anchor.anchorAccountId,
      });
      return c.json(
        {
          household: { id: hh.id, name: hh.name, principalUserId: hh.principalUserId },
          masterWallet: {
            id: provisioned.master.id,
            anchorVirtualAccount: provisioned.master.anchorVirtualAccount,
            anchorBankCode: provisioned.master.anchorBankCode,
            currency: provisioned.master.currency,
          },
        },
        201,
      );
    });
  })
  .get('/:id/sub-wallets', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findById(db, c.req.param('id'));
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    const subs = await subWalletsRepo.listByMaster(db, mw.id);
    const snoozes = await subwalletSnoozeRepo.listForUser(db, a.userId);
    const now = new Date();
    const snoozeMap = new Map<string, string | null>();
    for (const s of snoozes) {
      if (s.expiresAt === null || s.expiresAt > now) {
        snoozeMap.set(s.subWalletId, s.expiresAt?.toISOString() ?? null);
      }
    }
    const result = subs.map((sw) => ({
      ...sw,
      snoozedUntil: snoozeMap.has(sw.id) ? snoozeMap.get(sw.id) ?? null : null,
    }));
    return c.json({ subWallets: result }, 200);
  })
  .post('/:id/sub-wallets', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findById(db, c.req.param('id'));
    if (!hh) return c.json({ error: 'household_not_found' }, 404);
    if (hh.principalUserId !== a.userId) return c.json({ error: 'not_your_household' }, 403);
    const body = await c.req.json<{ agentUserId: string; name: string }>();
    if (!body.agentUserId || !body.name?.trim()) {
      return c.json({ error: 'missing_params' }, 400);
    }
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    const members = await householdsRepo.findMembers(db, hh.id);
    const isMember = members.some((m) => m.userId === body.agentUserId && m.role === 'agent');
    if (!isMember) return c.json({ error: 'agent_not_paired' }, 400);
    const provisioned = await subWalletsRepo.provision(db, {
      masterWalletId: mw.id,
      agentUserId: body.agentUserId,
      name: body.name.trim(),
    });
    return c.json(
      {
        subWallet: provisioned.sub,
        ledgerAccountId: provisioned.ledgerAccountId,
      },
      201,
    );
  });

export const meHouseholdRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/me/household', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findByPrincipal(db, a.userId);
    if (!hh) return c.json({ error: 'no_household' }, 404);
    const mw = await masterWalletsRepo.findByHousehold(db, hh.id);
    if (!mw) return c.json({ error: 'no_master_wallet' }, 500);
    return c.json(
      {
        household: { id: hh.id, name: hh.name, principalUserId: hh.principalUserId },
        masterWallet: {
          id: mw.id,
          anchorVirtualAccount: mw.anchorVirtualAccount,
          anchorBankCode: mw.anchorBankCode,
          currency: mw.currency,
          status: mw.status,
        },
      },
      200,
    );
  })
  .get('/me/household/members', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const hh = await householdsRepo.findByPrincipal(db, a.userId);
    if (!hh) return c.json({ error: 'no_household' }, 404);
    const members = await householdsRepo.findMembers(db, hh.id);
    return c.json({ members }, 200);
  });
