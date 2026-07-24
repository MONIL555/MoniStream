import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
];

const nextConfig: NextConfig = {
  compress: true, // Compress JSON and assets using Gzip/Brotli
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        pathname: '/vi/**',
      },
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'encrypted-tbn0.gstatic.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'c.saavncdn.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pagalworld.is',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pagalnew.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'share.google',
        pathname: '/**',
      },
    ],
    minimumCacheTTL: 2592000, // 30 days cache for remote images
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  // Optimize server-side packages
  serverExternalPackages: ['mongoose', 'jsonwebtoken', 'bcryptjs', 'firebase-admin'],
  turbopack: {},
};

export default withSerwist(nextConfig);
