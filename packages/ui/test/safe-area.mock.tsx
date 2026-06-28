import React, { type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const passthrough = (name: string) => {
  const Comp = ({ children, ...props }: AnyProps) =>
    React.createElement(name, props, children as ReactNode);
  Comp.displayName = name;
  return Comp;
};

export const SafeAreaView = passthrough('SafeAreaView');
export const SafeAreaProvider = passthrough('SafeAreaProvider');
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export const initialWindowMetrics = {
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
