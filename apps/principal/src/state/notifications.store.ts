import { ApiError } from '@amana/api-client';
import type { Notification } from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';

export type NotificationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type NotificationsState = {
  status: NotificationsStatus;
  items: Notification[];
  unreadCount: number;
  errorCode: string | null;

  refresh(): Promise<void>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
};

const ERR = (e: unknown): string =>
  e instanceof ApiError ? e.code : e instanceof Error ? e.message : 'unknown_error';

const computeUnread = (items: Notification[]): number =>
  items.filter((n) => n.status !== 'read' && n.status !== 'skipped').length;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  status: 'idle',
  items: [],
  unreadCount: 0,
  errorCode: null,

  async refresh() {
    set({ status: 'loading', errorCode: null });
    try {
      const r = await api.notification.listForMe();
      // The /me/notifications endpoint returns rows across all channels (in_app, push, sms).
      // For the inbox, show only the in_app row per dedupeKey to avoid duplicates.
      const seen = new Set<string>();
      const items = r.notifications.filter((n) => {
        if (n.channel !== 'in_app') return false;
        if (seen.has(n.dedupeKey)) return false;
        seen.add(n.dedupeKey);
        return true;
      });
      set({ status: 'ready', items, unreadCount: computeUnread(items) });
    } catch (e) {
      set({ status: 'error', errorCode: ERR(e) });
    }
  },

  async markRead(id) {
    const before = get().items;
    const next = before.map((n) => (n.id === id ? { ...n, status: 'read' as const } : n));
    set({ items: next, unreadCount: computeUnread(next) });
    try {
      await api.notification.markRead(id);
    } catch (e) {
      // Revert on error.
      set({ items: before, unreadCount: computeUnread(before), errorCode: ERR(e) });
    }
  },

  async markAllRead() {
    const unread = get().items.filter((n) => n.status !== 'read' && n.status !== 'skipped');
    // Sequential by design — each markRead's `before` snapshot must include prior iterations'
    // marks so a mid-loop failure reverts only the failing call, not previously-succeeded ones.
    for (const n of unread) {
      await get().markRead(n.id);
    }
  },
}));
