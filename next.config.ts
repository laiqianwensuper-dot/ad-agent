import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["openai"],
  agentRules: false,
  // The local preview is opened on 127.0.0.1; allow its HMR connection so
  // the client bundle can hydrate and buttons remain interactive in dev.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
