/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Support both ESM (existing code) and CommonJS (Next.js)
  experimental: {
    esmExternals: true,
  },
}

module.exports = nextConfig
