'use client';
import { type ReactNode, createContext, useContext } from 'react';
import type { Me, Permission } from './types';

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside MeProvider');
  return me;
}

/** The only question a screen asks. Roles are shown about people; permissions decide what renders. */
export function can(me: Me, permission: Permission): boolean {
  return me.permissions.includes(permission);
}
