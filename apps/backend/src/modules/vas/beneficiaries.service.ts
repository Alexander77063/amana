import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ForbiddenError } from '../../lib/errors';
import { usersRepo } from '../identity/users.repo';
import { assertSubWalletAccess } from '../wallet/wallet-access.service';
import { beneficiariesRepo } from './beneficiaries.repo';
import { VAS_RECIPIENT_KIND, type VasCategory } from './config';
import { normalizeRecipient } from './recipient';

type DbOrTx = PostgresJsDatabase;

export const beneficiariesService = {
  async add(
    db: DbOrTx,
    input: {
      actorUserId: string;
      subWalletId: string;
      kind: 'phone' | 'meter' | 'smartcard';
      value: string;
      label: string;
    },
  ) {
    // Principal-only: authorize the actor owns the sub-wallet's household.
    await assertSubWalletAccess(db, input.actorUserId, input.subWalletId, { principalOnly: true });
    return beneficiariesRepo.insert(db, {
      subWalletId: input.subWalletId,
      kind: input.kind,
      value: normalizeRecipient(input.kind, input.value),
      label: input.label,
      createdByUserId: input.actorUserId,
    });
  },

  async list(db: DbOrTx, actorUserId: string, subWalletId: string) {
    await assertSubWalletAccess(db, actorUserId, subWalletId); // owner (principal) or the agent may read
    return beneficiariesRepo.listActive(db, subWalletId);
  },

  async remove(db: DbOrTx, actorUserId: string, id: string) {
    const b = await beneficiariesRepo.findById(db, id);
    if (!b) throw new ForbiddenError('beneficiary not found');
    await assertSubWalletAccess(db, actorUserId, b.subWalletId, { principalOnly: true });
    await beneficiariesRepo.deactivate(db, id);
  },

  /** The cash-out control gate. Throws ForbiddenError if the recipient is not permitted. */
  async assertRecipientAllowed(
    db: DbOrTx,
    input: {
      subWalletId: string | null;
      agentUserId: string | null;
      category: VasCategory;
      recipient: string;
    },
  ): Promise<void> {
    if (!input.subWalletId) return; // principal-direct: principal owns the funds
    const kind = VAS_RECIPIENT_KIND[input.category];
    const value = normalizeRecipient(kind, input.recipient);

    // Own registered phone is always allowed for phone categories (airtime/data).
    if (kind === 'phone' && input.agentUserId) {
      const agent = await usersRepo.findById(db, input.agentUserId);
      if (agent && normalizeRecipient('phone', agent.phone) === value) return;
    }
    const hit = await beneficiariesRepo.findActive(db, input.subWalletId, kind, value);
    if (!hit) {
      throw new ForbiddenError(`recipient ${value} is not an approved ${kind} beneficiary`);
    }
  },
};
