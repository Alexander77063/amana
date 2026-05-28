import { create } from 'zustand';

export type SubWalletIdentity = {
  id: string;
  name: string;
  masterWalletId: string;
};

type AgentState = {
  selectedSubWallet: SubWalletIdentity | null;
  setSubWallet(sw: SubWalletIdentity): void;
  clearSubWallet(): void;
};

export const useAgentStore = create<AgentState>((set) => ({
  selectedSubWallet: null,
  setSubWallet: (sw) => set({ selectedSubWallet: sw }),
  clearSubWallet: () => set({ selectedSubWallet: null }),
}));
