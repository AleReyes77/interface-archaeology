import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The analyzer uses the TypeScript compiler API at runtime; keep it out of the bundle.
  serverExternalPackages: ["typescript"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
