import type { MyNotificationsResponse } from '@amana/types';
import type { AuthedClient } from './household-api';

export type MarkReadResult = { marked: true };

export class NotificationApi {
  constructor(private readonly client: AuthedClient) {}

  listForMe(): Promise<MyNotificationsResponse> {
    return this.client.request<MyNotificationsResponse>('/me/notifications');
  }

  markRead(id: string): Promise<MarkReadResult> {
    return this.client.request<MarkReadResult>(`/me/notifications/${id}/read`, {
      method: 'POST',
    });
  }
}
