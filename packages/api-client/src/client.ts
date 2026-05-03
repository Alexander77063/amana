export interface ClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class AmanaApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async health(): Promise<{ status: 'ok'; version: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`health check failed: ${res.status}`);
    }
    return (await res.json()) as { status: 'ok'; version: string };
  }
}
