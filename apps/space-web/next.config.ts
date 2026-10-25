import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    // Programme covers fill tall cards; 75 smears their dark gradients.
    qualities: [75, 88],
  },
}

export default nextConfig
