import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow cross-origin requests from dev tunnel
  allowedDevOrigins: ['dev-tunnel.skibri.us']
};

export default nextConfig;
