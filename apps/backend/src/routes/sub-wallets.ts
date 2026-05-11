import { SubWalletSnoozeInputSchema } from '@amana/validation';
import { Hono } from 'hono';
import { db } from '../db/client';
import { type ActorVariables, jwtAuth } from '../middleware/jwt-auth';
import { householdsRepo } from '../modules/identity/households.repo';
import { subwalletSnoozeRepo } from '../modules/notifications/subwallet-snooze.repo';
import { ruleSetService } from '../modules/rules/rule-set.service';
import { transactionListService } from '../modules/transactions/list.service';
import { balanceService } from '../modules/wallet/balance.service';
import { masterWalletsRepo } from '../modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../modules/wallet/sub-wallets.repo';

type DbType = typeof db;

async function ownerCheck(
  database: DbType,
  subWalletId: string,
  actorUserId: string,
): Promise<{ ok: true; subWalletId: string } | { ok: false; status: 403 | 404; code: string }> {
  const sw = await subWalletsRepo.findById(database, subWalletId);
  if (!sw) return { ok: false, status: 404, code: 'sub_wallet_not_found' };
  const mw = await masterWalletsRepo.findById(database, sw.masterWalletId);
  if (!mw) return { ok: false, status: 404, code: 'master_wallet_not_found' };
  const hh = await householdsRepo.findById(database, mw.householdId);
  if (!hh) return { ok: false, status: 404, code: 'household_not_found' };
  if (hh.principalUserId !== actorUserId)
    return { ok: false, status: 403, code: 'not_your_sub_wallet' };
  return { ok: true, subWalletId };
}

export const subWalletsRoute = new Hono<{ Variables: ActorVariables }>()
  .use(jwtAuth())
  .get('/:id', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const sw = await subWalletsRepo.findById(db, c.req.param('id'));
    return c.json({ subWallet: sw }, 200);
  })
  .patch('/:id', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const body = await c.req.json<{ status: 'active' | 'suspended' | 'closed' }>();
    if (!['active', 'suspended', 'closed'].includes(body.status)) {
      return c.json({ error: 'invalid_status' }, 400);
    }
    await subWalletsRepo.setStatus(db, c.req.param('id'), body.status);
    const sw = await subWalletsRepo.findById(db, c.req.param('id'));
    return c.json({ subWallet: sw }, 200);
  })
  .get('/:id/balance', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const balance = await balanceService.accountBalanceForSubWallet(db, c.req.param('id'));
    return c.json({ balanceKobo: balance.toString() }, 200);
  })
  .get('/:id/rules', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const active = await ruleSetService.getActiveWithRules(db, c.req.param('id'));
    return c.json({ activeRuleSet: active }, 200);
  })
  .post('/:id/rules', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);
    const body = await c.req.json<{
      rules: Array<{
        kind: string;
        priority: number;
        config: unknown;
      }>;
    }>();
    if (!Array.isArray(body.rules)) return c.json({ error: 'rules_required' }, 400);
    const result = await ruleSetService.publishNewVersion(db, {
      subWalletId: c.req.param('id'),
      createdByUserId: a.userId,
      rules: body.rules as Parameters<typeof ruleSetService.publishNewVersion>[1]['rules'],
    });
    return c.json({ ruleSet: result.ruleSet, rules: result.rules }, 201);
  })
  .put('/:id/snooze', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);

    const body = await c.req.json().catch(() => null);
    const parsed = SubWalletSnoozeInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_param', details: parsed.error.flatten() }, 400);
    }

    const expiresAt = parsed.data.until === null ? null : new Date(parsed.data.until);
    await subwalletSnoozeRepo.upsert(db, a.userId, c.req.param('id'), expiresAt);
    return c.json({ snoozedUntil: parsed.data.until }, 200);
  })
  .delete('/:id/snooze', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'principal') return c.json({ error: 'principal_only' }, 403);
    const check = await ownerCheck(db, c.req.param('id'), a.userId);
    if (!check.ok) return c.json({ error: check.code }, check.status);

    await subwalletSnoozeRepo.delete(db, a.userId, c.req.param('id'));
    return c.json({ snoozedUntil: null }, 200);
  })
  .get('/:id/transactions', async (c) => {
    const a = c.get('actor');
    if (a.role !== 'agent') return c.json({ error: 'agent_only' }, 403);

    const subWalletId = c.req.param('id');
    const sw = await subWalletsRepo.findById(db, subWalletId);
    if (!sw) return c.json({ error: 'not_found' }, 404);
    if (sw.agentUserId !== a.userId) return c.json({ error: 'forbidden' }, 403);

    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 50);
    const cursor = c.req.query('cursor') ?? null;

    const result = await transactionListService.listForSubWallet(db, { subWalletId, limit, cursor });
    return c.json(result, 200);
  });
