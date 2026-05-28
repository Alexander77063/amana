import { ApiError } from '@amana/api-client';
import type { HouseholdMember, HouseholdSummary, MasterWalletSummary } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { toErrorCode } from '../lib/store-utils';

export type HouseholdStatus = 'idle' | 'loading' | 'has_household' | 'no_household' | 'error';

export type HouseholdState = {
  status: HouseholdStatus;
  household: HouseholdSummary | null;
  masterWallet: MasterWalletSummary | null;
  members: HouseholdMember[];
  errorCode: string | null;

  bootstrap(): Promise<void>;
  createHousehold(name: string): Promise<void>;
  refreshMembers(): Promise<void>;
};

export const useHouseholdStore = create<HouseholdState>((set, get) => ({
  status: 'idle',
  household: null,
  masterWallet: null,
  members: [],
  errorCode: null,

  async bootstrap() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.household.getMyHousehold();
      set({
        status: 'has_household',
        household: r.household,
        masterWallet: r.masterWallet,
      });
      void get().refreshMembers();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_household') {
        set({ status: 'no_household', household: null, masterWallet: null, members: [] });
        return;
      }
      set({ status: 'error', errorCode: toErrorCode(e) });
    }
  },

  async createHousehold(name) {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.household.createHousehold({ name });
      set({
        status: 'has_household',
        household: r.household,
        masterWallet: r.masterWallet,
        members: [],
      });
    } catch (e) {
      set({ status: 'error', errorCode: toErrorCode(e) });
      throw e;
    }
  },

  async refreshMembers() {
    try {
      const r = await api.household.listMembers();
      set({ members: r.members });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },
}));
