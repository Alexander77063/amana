export interface TermiiSendRequest {
  to: string; // E.164 phone number
  from: string; // sender ID
  sms: string; // message body, max 612 chars
  type: 'plain';
  channel: 'generic';
  apiKey: string;
}

export interface TermiiSendResponse {
  message_id: string;
  message: string;
  balance: number;
  user: string;
}

export class TermiiClient {
  constructor(
    private baseUrl: string,
    private fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async sendSms(req: TermiiSendRequest): Promise<TermiiSendResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '<unreadable>');
      throw new Error(`Termii ${res.status}: ${errBody}`);
    }
    return res.json() as Promise<TermiiSendResponse>;
  }
}
