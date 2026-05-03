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
};

export default nextConfig;
