/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@amana/api-client` is consumed from the workspace as TypeScript source, so Next has to
  // compile it rather than assume a prebuilt package.
  transpilePackages: ['@amana/api-client'],
};

export default nextConfig;
