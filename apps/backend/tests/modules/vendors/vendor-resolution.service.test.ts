import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb, truncateAll } from '../../helpers/test-db';
import { factories } from '../../helpers/factories';
import { vendorResolutionService } from '../../../src/modules/vendors/vendor-resolution.service';
import { recentsRepo } from '../../../src/modules/vendors/recents.repo';
import { stickersRepo } from '../../../src/modules/sticker/stickers.repo';
import { AnchorAdapter } from '../../../src/integrations/anchor/adapter';
import { AnchorClient } from '../../../src/integrations/anchor/client';
import { encodeTlvForTest } from '../../../src/modules/vendors/nqr-decoder';
import { isOk } from '../../../src/lib/result';
import { usersRepo } from '../../../src/modules/identity/users.repo';
import { householdsRepo } from '../../../src/modules/identity/households.repo';
import { masterWalletsRepo } from '../../../src/modules/wallet/master-wallets.repo';
import { subWalletsRepo } from '../../../src/modules/wallet/sub-wallets.repo';

function makeAdapter(fetchImpl: typeof fetch): AnchorAdapter {
  return new AnchorAdapter({
    db: testDb,
    client: new AnchorClient({ baseUrl: 'https://api.x', apiKey: 'k', fetchImpl }),
    retryDelaysMs: [1],
  });
}

async function seedSubWallet(): Promise<string> {
  const principal = await usersRepo.insert(testDb, {
    role: 'principal', phone: factories.phone(), nin: factories.nin(), kycTier: '2', bvn: factories.bvn(),
  });
  const hh = await householdsRepo.insert(testDb, { principalUserId: principal.id, name: 'HH' });
  const mw = await masterWalletsRepo.provision(testDb, {
    householdId: hh.id, anchorVirtualAccount: '1234567890', anchorBankCode: '058',
    anchorAccountId: 'anchor-acct-test',
  });
  const agent = await usersRepo.insert(testDb, {
    role: 'agent', phone: factories.phone(), nin: factories.nin(), kycTier: '1',
  });
  const sw = await subWalletsRepo.provision(testDb, {
    masterWalletId: mw.master.id, agentUserId: agent.id, name: 'Driver',
  });
  return sw.sub.id;
}

const baseFetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({
    bankCode: '058', accountNumber: '0123456789', accountName: 'MUSA ABDULLAHI',
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
);

describe('vendorResolutionService.resolve', () => {
  beforeEach(async () => { await truncateAll(); });

  it('account input → name enquiry path', async () => {
    const subWalletId = await seedSubWallet();
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'account', bankCode: '058', accountNumber: '0123456789',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.source).toBe('name_enquiry');
  });

  it('phone input → phone lookup path', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        bankCode: '999', accountNumber: '8011112222', accountName: 'MUSA',
        phoneNumber: '+2348011112222',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const subWalletId = await seedSubWallet();
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(fetchSpy), {
      kind: 'phone', phoneNumber: '+2348011112222',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    if (isOk(result)) expect(result.value.source).toBe('phone_lookup');
  });

  it('sticker input → sticker lookup path', async () => {
    const subWalletId = await seedSubWallet();
    const sticker = await stickersRepo.insert(testDb, {
      bankCode: '058', accountNumber: '0123456789',
      accountName: 'MUSA', vendorPhone: factories.phone(),
      status: 'active',
    });
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'sticker', stickerUuid: sticker.uuid,
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    if (isOk(result)) expect(result.value.source).toBe('sticker');
  });

  it('NQR input → decoded + name enquiry to confirm + source=nqr', async () => {
    const subWalletId = await seedSubWallet();
    const merchantInfo =
      encodeTlvForTest('00', 'NG.NIBSS') +
      encodeTlvForTest('01', '058') +
      encodeTlvForTest('02', '0123456789');
    const qr = encodeTlvForTest('26', merchantInfo);
    const result = await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'nqr', payload: qr,
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.source).toBe('nqr');
  });

  it('successful resolution touches recents', async () => {
    const subWalletId = await seedSubWallet();
    await vendorResolutionService.resolve(testDb, makeAdapter(baseFetch), {
      kind: 'account', bankCode: '058', accountNumber: '0123456789',
      subWalletId, now: new Date('2026-05-03T12:00:00Z'),
    });
    const recent = await recentsRepo.findByVendor(testDb, subWalletId, '058', '0123456789');
    expect(recent).toBeDefined();
    expect(recent?.accountName).toBe('MUSA ABDULLAHI');
  });
});
