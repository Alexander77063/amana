import type { ActiveRuleSet, RuleInput, SubWallet, SubWalletStatus } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { toErrorCode } from '../lib/store-utils';

export type SubWalletsState = {
  byId: Record<string, SubWallet>;
  balanceById: Record<string, string>;
  rulesById: Record<string, ActiveRuleSet | null>;
  errorCode: string | null;
  busy: boolean;
  _snoozeSeq: Record<string, number>;

  refreshList(householdId: string): Promise<void>;
  create(householdId: string, agentUserId: string, name: string): Promise<SubWallet>;
  refreshOne(subWalletId: string): Promise<void>;
  refreshBalance(subWalletId: string): Promise<void>;
  refreshRules(subWalletId: string): Promise<void>;
  publishRules(subWalletId: string, rules: RuleInput[]): Promise<void>;
  setStatus(subWalletId: string, status: SubWalletStatus): Promise<void>;
  snooze(subWalletId: string, until: string | null): Promise<void>;
  unsnooze(subWalletId: string): Promise<void>;
};

export const useSubWalletsStore = create<SubWalletsState>((set, get) => ({
  byId: {},
  balanceById: {},
  rulesById: {},
  errorCode: null,
  busy: false,
  _snoozeSeq: {},

  async refreshList(householdId) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.listSubWallets(householdId);
      const byId: Record<string, SubWallet> = {};
      for (const s of r.subWallets) byId[s.id] = s;
      set({ byId, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
    }
  },

  async create(householdId, agentUserId, name) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.createSubWallet(householdId, { agentUserId, name });
      set({ byId: { ...get().byId, [r.subWallet.id]: r.subWallet }, busy: false });
      return r.subWallet;
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async refreshOne(subWalletId) {
    try {
      const r = await api.subWallet.get(subWalletId);
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async refreshBalance(subWalletId) {
    try {
      const r = await api.subWallet.getBalance(subWalletId);
      set({ balanceById: { ...get().balanceById, [subWalletId]: r.balanceKobo } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async refreshRules(subWalletId) {
    try {
      const r = await api.subWallet.getRules(subWalletId);
      set({ rulesById: { ...get().rulesById, [subWalletId]: r.activeRuleSet } });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async publishRules(subWalletId, rules) {
    set({ busy: true, errorCode: null });
    try {
      await api.subWallet.publishRules(subWalletId, { rules });
      await get().refreshRules(subWalletId);
      set({ busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async setStatus(subWalletId, status) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.subWallet.patchStatus(subWalletId, { status });
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet }, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async snooze(subWalletId, until) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    const optimistic = { ...before, snoozedUntil: until };
    set({
      byId: { ...get().byId, [subWalletId]: optimistic },
      _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq },
    });
    try {
      const r = await api.subWallet.snooze(subWalletId, until);
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      const cur = get().byId[subWalletId];
      if (!cur) return;
      set({ byId: { ...get().byId, [subWalletId]: { ...cur, snoozedUntil: r.snoozedUntil } } });
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({ byId: { ...get().byId, [subWalletId]: before }, errorCode: toErrorCode(e) });
    }
  },

  async unsnooze(subWalletId) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    const optimistic = { ...before, snoozedUntil: null };
    set({
      byId: { ...get().byId, [subWalletId]: optimistic },
      _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq },
    });
    try {
      await api.subWallet.unsnooze(subWalletId);
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({ byId: { ...get().byId, [subWalletId]: before }, errorCode: toErrorCode(e) });
    }
  },
}));
