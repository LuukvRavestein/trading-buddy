/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Support both ESM (existing code) and CommonJS (Next.js)
  experimental: {
    esmExternals: true,
  },
}

// Use CommonJS export for Next.js compatibility (even with "type": "module" in package.json)
module.exports = nextConfig
