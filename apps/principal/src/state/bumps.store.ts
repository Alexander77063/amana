import type { BumpDecision, BumpRequest } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { toErrorCode } from '../lib/store-utils';

export type BumpsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BumpsState = {
  status: BumpsStatus;
  pending: BumpRequest[];
  history: BumpRequest[];
  errorCode: string | null;
  decidingId: string | null;

  refresh(): Promise<void>;
  decide(bumpId: string, decision: BumpDecision): Promise<void>;
};

export const useBumpsStore = create<BumpsState>((set, get) => ({
  status: 'idle',
  pending: [],
  history: [],
  errorCode: null,
  decidingId: null,

  async refresh() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.bump.listForMe();
      set({ status: 'ready', pending: r.pending, history: r.history });
    } catch (e) {
      set({ status: 'error', errorCode: toErrorCode(e) });
    }
  },

  async decide(bumpId, decision) {
    if (get().decidingId !== null) return; // I2: ignore if a decide is already inflight
    const before = get();
    const target = before.pending.find((b) => b.id === bumpId);
    if (!target) {
      set({ errorCode: 'bump_not_found' });
      return;
    }
    // Optimistic move: remove from pending, prepend a synthetic decided row.
    const predictedStatus =
      decision === 'approve_once'
        ? 'approved_once'
        : decision === 'approve_raise_limit'
          ? 'raise_limit'
          : 'denied';
    const optimistic: BumpRequest = {
      ...target,
      status: predictedStatus,
      decidedAt: new Date().toISOString(),
    };
    set({
      decidingId: bumpId,
      pending: before.pending.filter((b) => b.id !== bumpId),
      history: [optimistic, ...before.history],
      errorCode: null,
    });
    try {
      const r = await api.bump.decide(bumpId, decision);
      // Reconcile to the server's reported status.
      set((s) => ({
        decidingId: null,
        history: s.history.map((b) => (b.id === bumpId ? { ...b, status: r.status } : b)),
      }));
    } catch (e) {
      // Revert.
      set({
        decidingId: null,
        pending: before.pending,
        history: before.history,
        errorCode: toErrorCode(e),
      });
    }
  },
}));
