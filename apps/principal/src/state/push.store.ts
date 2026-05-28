import type { DevicePlatform } from '@amana/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { api } from '../lib/api';
import { getExpoPushTokenOrNull } from '../lib/push';
import { toErrorCode } from '../lib/store-utils';

const DEVICE_ID_KEY = '@amana/principal/deviceId';

export type PushPermissionStatus = 'undetermined' | 'granted' | 'denied';

export type PushState = {
  permissionStatus: PushPermissionStatus;
  expoPushToken: string | null;
  deviceId: string | null;
  errorCode: string | null;

  /** Read OS permission status without prompting; load persisted deviceId. */
  bootstrap(): Promise<void>;
  /** Prompt the user, fetch token, register device with backend. Returns final permission. */
  requestPermissionAndRegister(): Promise<PushPermissionStatus>;
  /** Best-effort delete on backend + clear local. Called on logout. */
  unregister(): Promise<void>;
};

function osStatusToOurs(s: Notifications.PermissionStatus): PushPermissionStatus {
  if (s === 'granted') return 'granted';
  if (s === 'denied') return 'denied';
  return 'undetermined';
}

function platformOrNull(): DevicePlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

export const usePushStore = create<PushState>((set, get) => ({
  permissionStatus: 'undetermined',
  expoPushToken: null,
  deviceId: null,
  errorCode: null,

  async bootstrap() {
    try {
      const perm = await Notifications.getPermissionsAsync();
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      set({ permissionStatus: osStatusToOurs(perm.status), deviceId: stored });
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
    }
  },

  async requestPermissionAndRegister() {
    const platform = platformOrNull();
    if (!platform) {
      set({ permissionStatus: 'denied', errorCode: 'unsupported_platform' });
      return 'denied';
    }
    try {
      const perm = await Notifications.requestPermissionsAsync();
      const status = osStatusToOurs(perm.status);
      set({ permissionStatus: status });
      if (status !== 'granted') return status;

      const token = await getExpoPushTokenOrNull();
      if (!token) {
        // Simulator or no projectId — permission granted but we can't get a token.
        set({ expoPushToken: null });
        return status;
      }
      const r = await api.device.register({ expoPushToken: token, platform });
      await AsyncStorage.setItem(DEVICE_ID_KEY, r.id);
      set({ expoPushToken: token, deviceId: r.id });
      return status;
    } catch (e) {
      set({ errorCode: toErrorCode(e) });
      return get().permissionStatus;
    }
  },

  async unregister() {
    const id = get().deviceId;
    if (id) {
      try {
        await api.device.unregister(id);
      } catch {
        // Best-effort — even if delete fails, clear locally.
      }
    }
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    set({ deviceId: null, expoPushToken: null });
  },
}));
