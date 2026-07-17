import type { NextConfig } from "next";

// Same-origin API proxy: the browser hits /api on THIS app's origin and Next
// forwards to the Nest API. In prod, compose sets API_ORIGIN to the internal
// service (baked at build — see infra/docker/next.Dockerfile).
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@boca/config", "@boca/contracts"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
