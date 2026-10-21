import type { NextConfig } from 'next'

// A public, static page: it may be cached, but it is never framed and it sends
// nothing about the visitor to the sites it links to.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // The root layout lives under app/[lang], so unmatched URLs need a 404 that renders its own document.
    globalNotFound: true,
  },
  async redirects() {
    // Temporary, so the root can later negotiate the visitor's language without cached 308s.
    return [{ source: '/', destination: '/es', permanent: false }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
