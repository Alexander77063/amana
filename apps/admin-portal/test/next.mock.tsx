import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * Stands in for `next/link` and `next/navigation` under Vitest (see the aliases in
 * vitest.config.ts). The navigation state is module-level so a test can set the path, the query or
 * the route params before rendering, exactly as the real hooks would report them.
 */
let path = '/';
let search = '';
let params: Record<string, string> = {};

export const __router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
export const __setPath = (p: string) => {
  path = p;
};
export const __setSearch = (s: string) => {
  search = s;
};
export const __setParams = (p: Record<string, string>) => {
  params = p;
};

export default function Link({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

export const useRouter = () => __router;
export const usePathname = () => path;
export const useSearchParams = () => new URLSearchParams(search);
export const useParams = () => params;
