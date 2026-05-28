import { describe, expect, it, beforeEach } from 'vitest';
import { useAgentStore } from './agent.store';

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().clearSubWallet();
  });

  it('starts with null selectedSubWallet', () => {
    expect(useAgentStore.getState().selectedSubWallet).toBeNull();
  });

  it('setSubWallet stores the sub-wallet', () => {
    const sw = { id: 'sw-1', name: 'Test', masterWalletId: 'mw-1' };
    useAgentStore.getState().setSubWallet(sw);
    expect(useAgentStore.getState().selectedSubWallet).toEqual(sw);
  });

  it('clearSubWallet resets to null', () => {
    useAgentStore.getState().setSubWallet({ id: 'sw-1', name: 'Test', masterWalletId: 'mw-1' });
    useAgentStore.getState().clearSubWallet();
    expect(useAgentStore.getState().selectedSubWallet).toBeNull();
  });
});
