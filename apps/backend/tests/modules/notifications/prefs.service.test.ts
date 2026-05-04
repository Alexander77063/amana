import { beforeEach, describe, expect, it } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { prefsService } from '../../../src/modules/notifications/prefs.service';
import { prefsRepo } from '../../../src/modules/notifications/prefs.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';

describe('prefsService', () => {
  beforeEach(async () => { await truncateAll(); });

  async function aPrincipal(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal', phone: factories.phone(), nin: factories.nin(),
      kycTier: '2', bvn: factories.bvn(),
    });
    return u.id;
  }

  it('returns default matrix entry when no row exists', async () => {
    const userId = await aPrincipal();
    const r = await prefsService.getPreference(testDb, userId, 'bump_requested', 'push');
    expect(r.preference).toBe('real_time');
    expect(r.thresholdKobo).toBeNull();
  });

  it('upsert overrides default; second upsert promotes', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'silent',
    });
    const r1 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r1.preference).toBe('silent');
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const r2 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r2.preference).toBe('threshold');
    expect(r2.thresholdKobo).toBe(100_000n);
  });

  it('shouldSend respects silent preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'silent',
    });
    const decision = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 5_000n,
    }, 'push');
    expect(decision).toBe('skip_silent');
  });

  it('shouldSend respects threshold preference for amount-based kinds', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const above = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 200_000n,
    }, 'push');
    expect(above).toBe('send');
    const below = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 50_000n,
    }, 'push');
    expect(below).toBe('skip_threshold');
  });

  it('shouldSend respects digest preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId, kind: 'txn_settled', channel: 'push', preference: 'digest',
    });
    const decision = await prefsService.shouldSend(testDb, {
      kind: 'txn_settled', recipientUserId: userId, dedupeKey: 'd', payload: {},
      amountKobo: 5_000n,
    }, 'push');
    expect(decision).toBe('defer_digest');
  });
});
