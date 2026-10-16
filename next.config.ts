import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spawns stdio MCP servers (child_process) and must stay out of the bundle.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "unpdf"],
  turbopack: { root: __dirname },
  // A second instance (tests, another data folder) can build elsewhere: NEXT_DIST_DIR=.next-test.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
