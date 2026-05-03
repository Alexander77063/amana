export interface AnchorClientConfig {
  baseUrl: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}

export interface AnchorRequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class AnchorHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'AnchorHttpError';
    this.status = status;
    this.body = body;
  }
}

const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** Cache parsed bodies keyed by Response instance so the same mock Response can be read multiple times in tests. */
const responseBodyCache = new WeakMap<Response, unknown>();

async function readResponseBody(res: Response): Promise<unknown> {
  if (responseBodyCache.has(res)) {
    return responseBodyCache.get(res);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await res.json()
    : await res.text();
  responseBodyCache.set(res, payload);
  return payload;
}

export class AnchorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnchorClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async get<R>(path: string, opts: AnchorRequestOptions = {}): Promise<R> {
    return this.request<R>('GET', path, undefined, opts);
  }

  async post<R>(path: string, body: unknown, opts: AnchorRequestOptions = {}): Promise<R> {
    return this.request<R>('POST', path, body, opts);
  }

  private async request<R>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: AnchorRequestOptions,
  ): Promise<R> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const init: RequestInit = { method, headers, signal: opts.signal };
    if (body !== undefined) init.body = JSON.stringify(body, bigintReplacer);

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const payload = await readResponseBody(res);

    if (!res.ok) {
      throw new AnchorHttpError(
        res.status,
        payload,
        `Anchor ${method} ${path} → ${res.status}`,
      );
    }
    return payload as R;
  }
}
