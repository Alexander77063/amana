import { ApiError } from '@amana/api-client';
import type { ActiveRuleSet, RuleInput, SubWallet, SubWalletStatus } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';

export type SubWalletsState = {
  list: SubWallet[];
  byId: Record<string, SubWallet>;
  balanceById: Record<string, string>;
  rulesById: Record<string, ActiveRuleSet | null>;
  errorCode: string | null;
  busy: boolean;
  /** Monotonic counter to guard against stale optimistic responses. */
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

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

export const useSubWalletsStore = create<SubWalletsState>((set, get) => ({
  list: [],
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
      set({ list: r.subWallets, byId, busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
    }
  },

  async create(householdId, agentUserId, name) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.household.createSubWallet(householdId, { agentUserId, name });
      set({
        list: [...get().list, r.subWallet],
        byId: { ...get().byId, [r.subWallet.id]: r.subWallet },
        busy: false,
      });
      return r.subWallet;
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async refreshOne(subWalletId) {
    try {
      const r = await api.subWallet.get(subWalletId);
      set({ byId: { ...get().byId, [subWalletId]: r.subWallet } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async refreshBalance(subWalletId) {
    try {
      const r = await api.subWallet.getBalance(subWalletId);
      set({ balanceById: { ...get().balanceById, [subWalletId]: r.balanceKobo } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async refreshRules(subWalletId) {
    try {
      const r = await api.subWallet.getRules(subWalletId);
      set({ rulesById: { ...get().rulesById, [subWalletId]: r.activeRuleSet } });
    } catch (e) {
      set({ errorCode: ERR(e) });
    }
  },

  async publishRules(subWalletId, rules) {
    set({ busy: true, errorCode: null });
    try {
      await api.subWallet.publishRules(subWalletId, { rules });
      await get().refreshRules(subWalletId);
      set({ busy: false });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async setStatus(subWalletId, status) {
    set({ busy: true, errorCode: null });
    try {
      const r = await api.subWallet.patchStatus(subWalletId, { status });
      set({
        byId: { ...get().byId, [subWalletId]: r.subWallet },
        list: get().list.map((s) => (s.id === subWalletId ? r.subWallet : s)),
        busy: false,
      });
    } catch (e) {
      set({ busy: false, errorCode: ERR(e) });
      throw e;
    }
  },

  async snooze(subWalletId, until) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    // Optimistic write to byId AND list
    const optimistic = { ...before, snoozedUntil: until };
    set({
      byId: { ...get().byId, [subWalletId]: optimistic },
      list: get().list.map((s) => (s.id === subWalletId ? optimistic : s)),
      _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq },
    });
    try {
      const r = await api.subWallet.snooze(subWalletId, until);
      // Stale-response guard
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      const cur = get().byId[subWalletId];
      if (!cur) return;
      const reconciled = { ...cur, snoozedUntil: r.snoozedUntil };
      set({
        byId: { ...get().byId, [subWalletId]: reconciled },
        list: get().list.map((s) => (s.id === subWalletId ? reconciled : s)),
      });
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({
        byId: { ...get().byId, [subWalletId]: before },
        list: get().list.map((s) => (s.id === subWalletId ? before : s)),
        errorCode: ERR(e),
      });
    }
  },

  async unsnooze(subWalletId) {
    const seq = (get()._snoozeSeq[subWalletId] ?? 0) + 1;
    const before = get().byId[subWalletId];
    if (!before) return;
    const optimistic = { ...before, snoozedUntil: null };
    set({
      byId: { ...get().byId, [subWalletId]: optimistic },
      list: get().list.map((s) => (s.id === subWalletId ? optimistic : s)),
      _snoozeSeq: { ...get()._snoozeSeq, [subWalletId]: seq },
    });
    try {
      await api.subWallet.unsnooze(subWalletId);
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      // Server confirmed null — already optimistically applied; nothing to reconcile.
    } catch (e) {
      if (get()._snoozeSeq[subWalletId] !== seq) return;
      set({
        byId: { ...get().byId, [subWalletId]: before },
        list: get().list.map((s) => (s.id === subWalletId ? before : s)),
        errorCode: ERR(e),
      });
    }
  },
}));
