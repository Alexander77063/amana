import type {
  ChannelPreference,
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  QuietHours,
  UpsertPreferenceInput,
} from '@amana/types';
import { create } from 'zustand';
import { api } from '../lib/api';
import { toErrorCode } from '../lib/store-utils';

/**
 * Mirrors the server's DEFAULT_MATRIX in
 * `apps/backend/src/modules/notifications/prefs.service.ts`.
 * If the server matrix changes, update this in lockstep.
 *
 * The server enum includes 'digest' but no kind/channel uses it as a default,
 * so we restrict the type here to ChannelPreference.
 */
const DEFAULT_MATRIX: Record<NotificationKind, Record<NotificationChannel, ChannelPreference>> = {
  bump_requested: { push: 'real_time', sms: 'real_time', in_app: 'real_time' },
  bump_decided: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_settled: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  txn_failed: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  anomaly_alert: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
  refund_received: { push: 'real_time', sms: 'silent', in_app: 'real_time' },
};

export type PreferencesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type EffectivePreference = {
  preference: ChannelPreference;
  thresholdKobo: string | null;
  /** True if no override row exists — falling back to DEFAULT_MATRIX. */
  isDefault: boolean;
};

export type PreferencesState = {
  status: PreferencesStatus;
  rows: NotificationPreference[];
  errorCode: string | null;
  quietHours: QuietHours | null;

  bootstrap(): Promise<void>;
  getEffective(kind: NotificationKind, channel: NotificationChannel): EffectivePreference;
  set(input: UpsertPreferenceInput): Promise<void>;
  loadQuietHours(): Promise<void>;
  saveQuietHours(input: QuietHours): Promise<void>;
};

/**
 * Replace or append a row keyed by (kind, channel).
 * Returns a fresh array — does not mutate the input.
 */
function upsertRow(
  rows: NotificationPreference[],
  next: NotificationPreference,
): NotificationPreference[] {
  const idx = rows.findIndex((r) => r.kind === next.kind && r.channel === next.channel);
  if (idx === -1) return [...rows, next];
  const copy = rows.slice();
  copy[idx] = next;
  return copy;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  status: 'idle',
  rows: [],
  errorCode: null,
  quietHours: null,

  async bootstrap() {
    if (get().status === 'loading') return;
    set({ status: 'loading', errorCode: null });
    try {
      const [prefs, qh] = await Promise.all([
        api.preference.listForMe(),
        api.preference.getQuietHours(),
      ]);
      set({
        status: 'ready',
        rows: prefs.preferences,
        quietHours: qh,
        errorCode: null,
      });
    } catch (e) {
      set({ status: 'error', errorCode: toErrorCode(e) });
    }
  },

  getEffective(kind, channel) {
    const row = get().rows.find((r) => r.kind === kind && r.channel === channel);
    if (!row) {
      return {
        preference: DEFAULT_MATRIX[kind][channel],
        thresholdKobo: null,
        isDefault: true,
      };
    }
    // 'digest' read from a power-user row → display as 'silent' for v1.
    const preference: ChannelPreference = row.preference === 'digest' ? 'silent' : row.preference;
    return {
      preference,
      thresholdKobo: row.thresholdKobo,
      isDefault: false,
    };
  },

  async set(input) {
    const before = get().rows;
    // Optimistic: synthesize a row matching the upsert. UpdatedAt is a placeholder
    // that gets reconciled to the server's response.
    const optimistic: NotificationPreference = {
      userId: '',
      kind: input.kind,
      channel: input.channel,
      preference: input.preference,
      thresholdKobo: input.thresholdKobo ?? null,
      updatedAt: new Date().toISOString(),
    };
    set({ rows: upsertRow(before, optimistic), errorCode: null });
    try {
      const r = await api.preference.upsert(input);
      // Concurrent-edit guard: if a slower upsert response arrives after a faster newer one
      // has already updated the row, ignore the stale response. Compare ISO timestamps.
      set((s) => {
        const current = s.rows.find(
          (row) => row.kind === r.preference.kind && row.channel === r.preference.channel,
        );
        if (current && current.updatedAt > r.preference.updatedAt) return s;
        return { rows: upsertRow(s.rows, r.preference) };
      });
    } catch (e) {
      set({ rows: before, errorCode: toErrorCode(e) });
    }
  },

  async loadQuietHours() {
    try {
      const r = await api.preference.getQuietHours();
      set({ quietHours: r });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async saveQuietHours(input) {
    const before = get().quietHours;
    set({ quietHours: input }); // optimistic
    try {
      const r = await api.preference.upsertQuietHours(input);
      set({ quietHours: r });
    } catch (e) {
      set({ quietHours: before, errorCode: toErrorCode(e) });
    }
  },
}));
