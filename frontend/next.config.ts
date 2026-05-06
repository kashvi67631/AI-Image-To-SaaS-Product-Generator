import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** This app’s folder (…/frontend). Stops Next from picking a parent lockfile as the workspace root. */
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: ".next",
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  transpilePackages: ["react-syntax-highlighter", "react-live"],
  outputFileTracingRoot: appRoot,
  experimental: {
    optimizePackageImports: ["react-syntax-highlighter", "react-live"],
  },
  turbopack: {
    root: appRoot,
  },
  /**
   * Same-origin proxy: /api/proxy/:path* → backend origin + :path*
   * Development default destination: http://127.0.0.1:8080 (IPv4; avoids ::1 issues).
   * Restart `next dev` after changing BACKEND_URL.
   */
  async rewrites() {
    const forcedDestination = "http://127.0.0.1:8080/:path*";
    return [{ source: "/api/proxy/:path*", destination: forcedDestination }];
  },
};

export default nextConfig;
