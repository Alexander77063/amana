// apps/backend/tests/helpers/bearer.ts
import { sessionService } from '../../src/modules/auth/session.service';
import type { UserRow } from '../../src/modules/identity/users.repo';
import { testDb } from './test-db';

export async function bearerHeaders(user: UserRow): Promise<{
  Authorization: string;
  'content-type': string;
}> {
  const tokens = await sessionService.issue(testDb, { userId: user.id, role: user.role });
  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    'content-type': 'application/json',
  };
}
