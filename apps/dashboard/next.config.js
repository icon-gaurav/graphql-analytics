/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['postgres'],
  },
};

module.exports = nextConfig;


