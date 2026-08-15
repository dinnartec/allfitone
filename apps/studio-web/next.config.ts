import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  async headers() {
    const noStore = [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }]
    return [{ source: '/organizations/:path*', headers: noStore }]
  },
}

export default nextConfig
