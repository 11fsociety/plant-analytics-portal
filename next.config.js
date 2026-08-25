/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false };
    return config;
  },
  async headers() {
    return [
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }] },
      { source: '/sw.js', headers: [{ key: 'Content-Type', value: 'application/javascript' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};
module.exports = nextConfig;
