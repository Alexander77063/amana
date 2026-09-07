import type {
  AdminSummary,
  Approval,
  ApprovalOutcome,
  ApprovalStatus,
  ClaimAttempt,
  ConsentPurpose,
  ConsentRow,
  Me,
  Retailer,
  RetailerStatus,
  Role,
  RoleGrant,
  VendorStatus,
  VendorSummary,
} from './types';

/**
 * The portal's API layer. Relative paths, same-origin credentials, no token store: the session is
 * a cookie the backend set on THIS host (see lib/proxy.ts), so the browser attaches it on its own.
 *
 * Deliberately not `@amana/api-client` — that client exists for bearer-token mobile apps, insists
 * on a token store, and never sends credentials. Teaching it cookies to serve one web app would
 * put risk into the two apps that move money for no mobile benefit. This is the recorded
 * exception to the retailer portal's "consume only the client" rule.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string | null,
  ) {
    super(`${status} ${code}${detail ? `: ${detail}` : ''}`);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    | ({ error?: string; detail?: string } & Record<string, unknown>)
    | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'unknown', body?.detail ?? null);
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

/** Where sign-in begins. A plain link, not a fetch: the backend answers with a redirect to Google. */
export const signInHref = '/admin/auth/start';

export const api = {
  me: () => request<Me>('/admin/me'),
  signOut: () => post<void>('/admin/auth/logout'),

  approvals: {
    list: (status: 'pending' | 'decided' = 'pending') =>
      request<{ approvals: Approval[] }>(`/admin/approvals${qs({ status })}`),
    approve: (id: string, reason?: string) =>
      post<ApprovalOutcome>(`/admin/approvals/${id}/approve`, { reason }),
    reject: (id: string, reason?: string) =>
      post<void>(`/admin/approvals/${id}/reject`, { reason }),
    cancel: (id: string) => post<void>(`/admin/approvals/${id}/cancel`),
  },

  iam: {
    admins: () => request<{ admins: AdminSummary[] }>('/admin/iam/admins'),
    onboard: (email: string) =>
      post<{ id: string; email: string; roles: Role[] }>('/admin/iam/admins', { email }),
    grants: (id: string) => request<{ grants: RoleGrant[] }>(`/admin/iam/admins/${id}/roles`),
    grant: (id: string, role: Role, reason?: string) =>
      post<{ approvalId: string; status: ApprovalStatus }>(`/admin/iam/admins/${id}/roles`, {
        role,
        reason,
      }),
    revoke: (id: string, role: Role, reason?: string) =>
      post<void>(`/admin/iam/admins/${id}/roles/revoke`, { role, reason }),
  },

  vendors: {
    queue: () => request<{ attempts: ClaimAttempt[] }>('/vendors-admin/claim-queue'),
    search: (status?: VendorStatus, q?: string) =>
      request<{ vendors: VendorSummary[] }>(`/vendors-admin/vendors${qs({ status, q })}`),
    get: (id: string) =>
      request<{ vendor: VendorSummary; claimAttempts: ClaimAttempt[] }>(
        `/vendors-admin/vendors/${id}`,
      ),
    proposeClaim: (id: string, phone: string, category: string | null) =>
      post<{ approvalId: string; status: ApprovalStatus }>(
        `/vendors-admin/vendors/${id}/approve-claim`,
        { phone, category },
      ),
    setCategory: (id: string, category: string | null) =>
      post<{ ok: true }>(`/vendors-admin/vendors/${id}/category`, { category }),
    suspend: (id: string) => post<{ ok: true }>(`/vendors-admin/vendors/${id}/suspend`),
    consents: (id: string) =>
      request<{ current: Partial<Record<ConsentPurpose, ConsentRow>>; history: ConsentRow[] }>(
        `/vendors-admin/vendors/${id}/consents`,
      ),
    revokeConsent: (id: string, purpose: ConsentPurpose) =>
      post<{ ok: true }>(`/vendors-admin/vendors/${id}/consents/revoke`, { purpose }),
    setEnforcement: (householdId: string, enforced: boolean | null) =>
      post<{ ok: true }>(`/vendors-admin/households/${householdId}/enforcement`, { enforced }),
  },

  retailers: {
    list: (status: RetailerStatus = 'applied') =>
      request<Retailer[]>(`/retailers${qs({ status })}`),
    get: (id: string) => request<Retailer>(`/retailers/${id}`),
    create: (input: {
      businessName: string;
      payoutBankCode: string;
      payoutAccountNumber: string;
    }) => post<Retailer>('/retailers', input),
    kyb: (id: string, input: { bvn: string; rcNumber?: string; email?: string }) =>
      post<Retailer>(`/retailers/${id}/kyb`, input),
    approve: (id: string) => post<Retailer>(`/retailers/${id}/approve`),
    suspend: (id: string) => post<Retailer>(`/retailers/${id}/suspend`),
  },
};
