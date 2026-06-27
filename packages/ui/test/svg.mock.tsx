import React, { type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

const host = (name: string) => {
  const Comp = ({ children, ...props }: AnyProps) =>
    React.createElement(name, props, children as ReactNode);
  Comp.displayName = name;
  return Comp;
};

// Any react-native-svg primitive (Svg, Polygon, Path, Circle, G, …) resolves to
// a named host element so the tree stays queryable.
const cache = new Map<string, ReturnType<typeof host>>();
const handler: ProxyHandler<Record<string, unknown>> = {
  get(_target, prop: string) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return svgProxy;
    if (!cache.has(prop)) cache.set(prop, host(prop));
    return cache.get(prop);
  },
};

const svgProxy = new Proxy({}, handler) as Record<string, unknown>;

export const Svg = svgProxy.Svg;
export const Polygon = svgProxy.Polygon;
export const Path = svgProxy.Path;
export const Circle = svgProxy.Circle;
export const Rect = svgProxy.Rect;
export const G = svgProxy.G;
export const Defs = svgProxy.Defs;
export const Stop = svgProxy.Stop;
export const LinearGradient = svgProxy.LinearGradient;
export default svgProxy;
