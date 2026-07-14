import type { NextConfig } from "next";

// Same-origin API access: the browser only ever talks to /api on THIS app's
// origin; Next proxies to the Nest API. Override the target with API_ORIGIN
// (prod compose points it at the api service; dev default matches apps/api
// PORT=3000 from the root .env).
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Slim, self-contained server bundle for the production Docker image.
  output: "standalone",
  // Workspace packages export raw TypeScript (exports -> ./src/index.ts).
  transpilePackages: ["@boca/contracts", "@boca/config"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
