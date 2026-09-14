/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone so the Docker image ships `.next/standalone` + a node server, not the pnpm tree.
  output: 'standalone',
  // No `rewrites`: the backend prefixes are proxied by explicit Route Handlers under app/, which
  // copy status, Set-Cookie and Location by hand and are unit-tested. See lib/proxy.ts.
};

export default nextConfig;
