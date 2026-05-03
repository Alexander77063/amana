import { createHash } from 'node:crypto';

const NIP_NARRATION_MAX_LEN = 64;

export function hashAgentReference(agentUserId: string): string {
  // Stable, lowercased, 5 chars. Not cryptographically reversible; we hold the un-hashed
  // NIN in the audit log linked to the same hash (Decision #15).
  return createHash('sha256').update(`amana-agent:${agentUserId}`).digest('hex').slice(0, 5);
}

export function formatAgentNarration(householdRef: string, agentUserId: string): string {
  const tag = hashAgentReference(agentUserId);
  return truncate(`AMN/AGT/${tag}/${householdRef}`);
}

export function formatPrincipalNarration(householdRef: string): string {
  return truncate(`AMN/${householdRef}`);
}

export type NarrationInput = {
  householdRef: string;
  agentUserId: string | null;
};

export function selectNarration(input: NarrationInput): string {
  return input.agentUserId === null
    ? formatPrincipalNarration(input.householdRef)
    : formatAgentNarration(input.householdRef, input.agentUserId);
}

function truncate(s: string): string {
  return s.length <= NIP_NARRATION_MAX_LEN ? s : s.slice(0, NIP_NARRATION_MAX_LEN);
}
