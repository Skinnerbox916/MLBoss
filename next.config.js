/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 's.yimg.com',
        pathname: '/**',
      },
    ],
  },
  // Add webpack configuration to handle Node.js built-in modules
  webpack: (config, { isServer }) => {
    // Only run this on the client-side build
    if (!isServer) {
      // Make Node.js modules empty on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        dgram: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig 