import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tallyline/types"],
  // no `x-powered-by: Next.js` fingerprint
  poweredByHeader: false,
};

export default nextConfig;
