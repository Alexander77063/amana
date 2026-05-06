export type DevicePlatform = 'ios' | 'android';

export type RegisterDeviceInput = {
  expoPushToken: string;
  platform: DevicePlatform;
  deviceLabel?: string | null;
};

export type RegisterDeviceResult = {
  id: string;
};
