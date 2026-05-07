import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { prefsRepo } from '../../../src/modules/notifications/prefs.repo';
import { prefsService } from '../../../src/modules/notifications/prefs.service';
import { quietHoursRepo } from '../../../src/modules/notifications/quiet-hours.repo';
import { subwalletSnoozeRepo } from '../../../src/modules/notifications/subwallet-snooze.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

describe('prefsService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  async function aPrincipal(): Promise<string> {
    const u = await usersRepo.insert(testDb, {
      role: 'principal',
      phone: factories.phone(),
      nin: factories.nin(),
      kycTier: '2',
      bvn: factories.bvn(),
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
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'silent',
    });
    const r1 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r1.preference).toBe('silent');
    await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const r2 = await prefsService.getPreference(testDb, userId, 'txn_settled', 'push');
    expect(r2.preference).toBe('threshold');
    expect(r2.thresholdKobo).toBe(100_000n);
  });

  it('shouldSend respects silent preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'silent',
    });
    const decision = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: userId,
        dedupeKey: 'd',
        payload: {},
        amountKobo: 5_000n,
      },
      'push',
    );
    expect(decision).toBe('skip_silent');
  });

  it('shouldSend respects threshold preference for amount-based kinds', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'threshold',
      thresholdKobo: 100_000n,
    });
    const above = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: userId,
        dedupeKey: 'd',
        payload: {},
        amountKobo: 200_000n,
      },
      'push',
    );
    expect(above).toBe('send');
    const below = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: userId,
        dedupeKey: 'd',
        payload: {},
        amountKobo: 50_000n,
      },
      'push',
    );
    expect(below).toBe('skip_threshold');
  });

  it('shouldSend respects digest preference', async () => {
    const userId = await aPrincipal();
    await prefsRepo.upsert(testDb, {
      userId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'digest',
    });
    const decision = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: userId,
        dedupeKey: 'd',
        payload: {},
        amountKobo: 5_000n,
      },
      'push',
    );
    expect(decision).toBe('defer_digest');
  });
});

async function seedPrincipalAndSubWallet() {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '2',
    bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, {
    principalUserId: principal.id,
    name: 'HH',
  });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id,
    anchorVirtualAccount: factories.bankAccount(),
    anchorBankCode: '058',
    anchorAccountId: `anchor-acct-${Date.now()}`,
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent',
    phone: factories.phone(),
    nin: factories.nin(),
    kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id,
    agentUserId: agent.id,
    name: 'Driver',
  });
  return { principalId: principal.id, subWalletId: sw.sub.id };
}

describe('prefsService.shouldSend — quiet layer', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "skip_snoozed" when matrix=send + sub-wallet is snoozed (push, non-breakthrough kind)', async () => {
    const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
    await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
    const decision = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: principalId,
        dedupeKey: 'test:1',
        payload: {},
        amountKobo: 1_000_000n,
        subWalletId,
      },
      'push',
    );
    expect(decision).toBe('skip_snoozed');
  });

  it('returns "skip_quiet_hours" when matrix=send + within quiet window (sms, non-breakthrough kind)', async () => {
    const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
    // Default for refund_received SMS is 'silent', so override to real_time.
    await prefsRepo.upsert(testDb, {
      userId: principalId,
      kind: 'refund_received',
      channel: 'sms',
      preference: 'real_time',
      thresholdKobo: null,
    });
    await quietHoursRepo.upsert(testDb, principalId, {
      enabled: true,
      startMinute: 1320,
      endMinute: 420,
    });
    // 03:00 Africa/Lagos = 02:00 UTC — well inside the cross-midnight window.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 7, 2, 0)));
    const decision = await prefsService.shouldSend(
      testDb,
      {
        kind: 'refund_received',
        recipientUserId: principalId,
        dedupeKey: 'test:2',
        payload: {},
        subWalletId,
      },
      'sms',
    );
    expect(decision).toBe('skip_quiet_hours');
  });

  it('returns "skip_silent" (matrix wins) when user has set kind=silent AND sub-wallet is snoozed', async () => {
    const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
    await prefsRepo.upsert(testDb, {
      userId: principalId,
      kind: 'txn_settled',
      channel: 'push',
      preference: 'silent',
      thresholdKobo: null,
    });
    await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
    const decision = await prefsService.shouldSend(
      testDb,
      {
        kind: 'txn_settled',
        recipientUserId: principalId,
        dedupeKey: 'test:3',
        payload: {},
        subWalletId,
      },
      'push',
    );
    expect(decision).toBe('skip_silent'); // matrix beats quiet
  });
});
