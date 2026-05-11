export type SubWalletSnoozeInput = {
  /** ISO8601 future timestamp, or null for indefinite mute. */
  until: string | null;
};

export type SubWalletWithPrincipal = {
  subWallet: { id: string; name: string; masterWalletId: string };
  principal: { userId: string; phone: string };
};
