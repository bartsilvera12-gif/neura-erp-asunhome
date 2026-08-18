import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Coolify / Docker: genera .next/standalone con server.js y sus deps mínimas.
  output: "standalone",
};

export default nextConfig;
