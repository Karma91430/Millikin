import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spawns stdio MCP servers (child_process) and must stay out of the bundle.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "unpdf"],
  turbopack: { root: __dirname },
};

export default nextConfig;
