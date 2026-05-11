export type SubWalletIdentity = {
  id: string;
  name: string;
  masterWalletId: string;
};

let _sw: SubWalletIdentity | null = null;

export const subWalletMemory = {
  get(): SubWalletIdentity | null { return _sw; },
  set(sw: SubWalletIdentity): void { _sw = sw; },
  clear(): void { _sw = null; },
};
