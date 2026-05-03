import { randomUUID } from 'node:crypto';

let counter = 0;
const next = () => ++counter;

export const factories = {
  userId: (): string => randomUUID(),
  householdId: (): string => randomUUID(),
  walletId: (): string => randomUUID(),
  txnId: (): string => randomUUID(),

  phone: (): string => `+234801${String(1000000 + next()).padStart(7, '0')}`,
  bvn: (): string => String(11111111111n + BigInt(next())).slice(-11),
  nin: (): string => String(22222222222n + BigInt(next())).slice(-11),

  bankAccount: (): string => String(1000000000n + BigInt(next())).slice(-10),
  bankCode: (): string => '058',

  idempotencyKey: (): string => `test-${randomUUID()}`,
  nibssSessionId: (): string =>
    `100${Date.now().toString().slice(-9)}${String(next()).padStart(6, '0')}`.slice(0, 30),

  kobo: (naira: number): bigint => BigInt(Math.round(naira * 100)),
};
