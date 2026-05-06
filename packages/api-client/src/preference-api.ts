import type {
  MyNotificationPreferencesResponse,
  NotificationPreference,
  UpsertPreferenceInput,
} from '@amana/types';
import type { AuthedClient } from './household-api';

export type UpsertPreferenceResult = { preference: NotificationPreference };

export class PreferenceApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(): Promise<MyNotificationPreferencesResponse> {
    return this.client.request<MyNotificationPreferencesResponse>('/me/notification-preferences');
  }

  upsert(input: UpsertPreferenceInput): Promise<UpsertPreferenceResult> {
    return this.client.request<UpsertPreferenceResult>('/me/notification-preferences', {
      method: 'PUT',
      jsonBody: input,
    });
  }
}
