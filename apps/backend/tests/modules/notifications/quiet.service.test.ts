import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';
import { quietHoursRepo } from '../../../src/modules/notifications/quiet-hours.repo';
import { quietService } from '../../../src/modules/notifications/quiet.service';
import { subwalletSnoozeRepo } from '../../../src/modules/notifications/subwallet-snooze.repo';
import type {
  NotificationChannel,
  NotificationIntent,
  NotificationKind,
} from '../../../src/modules/notifications/types';
import { factories } from '../../helpers/factories';
import { testDb, truncateAll } from '../../helpers/test-db';

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

function intent(
  kind: NotificationKind,
  recipientUserId: string,
  subWalletId?: string,
): NotificationIntent {
  return {
    kind,
    recipientUserId,
    dedupeKey: `test:${Math.random()}`,
    payload: {},
    subWalletId,
  };
}

function lagosDate(h: number, m: number): Date {
  return new Date(Date.UTC(2026, 4, 7, h - 1, m, 0));
}

describe('quietService.reasonQuiet', () => {
  beforeEach(async () => {
    await truncateAll();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('exemptions', () => {
    it('returns null for in_app channel regardless of any quiet config', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      vi.setSystemTime(lagosDate(3, 0));
      await quietHoursRepo.upsert(testDb, principalId, {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });
      for (const kind of [
        'txn_settled',
        'txn_failed',
        'refund_received',
        'bump_decided',
      ] as NotificationKind[]) {
        expect(
          await quietService.reasonQuiet(testDb, intent(kind, principalId, subWalletId), 'in_app'),
        ).toBeNull();
      }
    });

    it('returns null for breakthrough kinds (anomaly_alert, bump_requested) on push and sms', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      for (const ch of ['push', 'sms'] as NotificationChannel[]) {
        expect(
          await quietService.reasonQuiet(
            testDb,
            intent('anomaly_alert', principalId, subWalletId),
            ch,
          ),
        ).toBeNull();
        expect(
          await quietService.reasonQuiet(
            testDb,
            intent('bump_requested', principalId, subWalletId),
            ch,
          ),
        ).toBeNull();
      }
    });
  });

  describe('snooze', () => {
    it('returns "snooze" when active for that sub-wallet', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      expect(
        await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        ),
      ).toBe('snooze');
    });

    it('returns null when intent has no subWalletId (principal direct spend)', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      expect(
        await quietService.reasonQuiet(testDb, intent('txn_settled', principalId, undefined), 'push'),
      ).toBeNull();
    });

    it('returns null when snooze is expired', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      const past = new Date(Date.now() - 60_000);
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, past);
      expect(
        await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        ),
      ).toBeNull();
    });
  });

  describe('quiet hours window (Africa/Lagos)', () => {
    it('cross-midnight 22:00 → 07:00 — boundary checks', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await quietHoursRepo.upsert(testDb, principalId, {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });

      const cases: [number, number, 'quiet_hours' | null][] = [
        [21, 59, null],
        [22, 0, 'quiet_hours'],
        [3, 0, 'quiet_hours'],
        [6, 59, 'quiet_hours'],
        [7, 0, null],
        [12, 0, null],
      ];
      for (const [h, m, expected] of cases) {
        vi.setSystemTime(lagosDate(h, m));
        const reason = await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        );
        expect(reason, `at ${h}:${m.toString().padStart(2, '0')} Lagos`).toBe(expected);
      }
    });

    it('non-cross-midnight 13:00 → 14:00 — boundary checks', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await quietHoursRepo.upsert(testDb, principalId, {
        enabled: true,
        startMinute: 780,
        endMinute: 840,
      });

      const cases: [number, number, 'quiet_hours' | null][] = [
        [12, 59, null],
        [13, 0, 'quiet_hours'],
        [13, 30, 'quiet_hours'],
        [13, 59, 'quiet_hours'],
        [14, 0, null],
      ];
      for (const [h, m, expected] of cases) {
        vi.setSystemTime(lagosDate(h, m));
        const reason = await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        );
        expect(reason, `at ${h}:${m.toString().padStart(2, '0')} Lagos`).toBe(expected);
      }
    });

    it('returns null when enabled=false (regardless of time)', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await quietHoursRepo.upsert(testDb, principalId, {
        enabled: false,
        startMinute: 1320,
        endMinute: 420,
      });
      vi.setSystemTime(lagosDate(3, 0));
      expect(
        await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        ),
      ).toBeNull();
    });
  });

  describe('precedence', () => {
    it('snooze beats quiet hours when both active', async () => {
      const { principalId, subWalletId } = await seedPrincipalAndSubWallet();
      await subwalletSnoozeRepo.upsert(testDb, principalId, subWalletId, null);
      await quietHoursRepo.upsert(testDb, principalId, {
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
      });
      vi.setSystemTime(lagosDate(3, 0));
      expect(
        await quietService.reasonQuiet(
          testDb,
          intent('txn_settled', principalId, subWalletId),
          'push',
        ),
      ).toBe('snooze');
    });
  });
});
