import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The nav says "Briefings" and "Researchers"; make those words work as URLs too.
  async redirects() {
    return [
      { source: "/briefings", destination: "/ask", permanent: true },
      { source: "/researchers", destination: "/people", permanent: true },
    ];
  },
  turbopack: {
    // The repo root also has a package.json (Neon config); this app's root is apps/web.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
