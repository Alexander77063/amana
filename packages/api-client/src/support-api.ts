import type { AuthedClient } from './household-api';

export type SupportRespondResult = {
  outcome: 'verified' | 'denied' | 'expired' | 'not_found';
};

/**
 * The customer's half of support number matching (sub-plan A1 Task 6).
 *
 * Shared by BOTH apps: a principal and an agent answer the same challenge, so there is one client
 * rather than two that can drift. The verification is named in the path, but the backend binds the
 * answer to the authenticated user — the id alone grants nothing.
 */
export class SupportApi {
  constructor(private readonly client: AuthedClient) {}

  /**
   * Answer a verification with the number the operator read aloud.
   *
   * Every outcome — including `denied` and `not_found` — comes back as a normal result, never a
   * thrown error. A wrong tap is an ordinary answer the screen has to explain, not a crash.
   */
  respond(verificationId: string, chosenNumber: number): Promise<SupportRespondResult> {
    return this.client.request<SupportRespondResult>(
      `/support/verifications/${verificationId}/respond`,
      { method: 'POST', jsonBody: { chosenNumber } },
    );
  }
}
