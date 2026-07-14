import type { NextConfig } from "next";

// The AI evaluation section is genuinely live: it proxies to the running Boca
// API (default :3000). Everything else in the showcase is static prototype data.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Slim, self-contained server bundle for the production Docker image.
  output: "standalone",
  transpilePackages: ["@boca/config"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
