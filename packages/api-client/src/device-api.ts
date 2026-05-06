import type { RegisterDeviceInput, RegisterDeviceResult } from '@amana/types';
import type { AuthedClient } from './household-api';

export type UnregisterDeviceResult = { deleted: true };

export class DeviceApi {
  constructor(private readonly client: AuthedClient) {}

  register(input: RegisterDeviceInput): Promise<RegisterDeviceResult> {
    return this.client.request<RegisterDeviceResult>('/devices', {
      method: 'POST',
      jsonBody: input,
    });
  }

  unregister(deviceId: string): Promise<UnregisterDeviceResult> {
    return this.client.request<UnregisterDeviceResult>(`/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }
}
