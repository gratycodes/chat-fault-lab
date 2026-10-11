import type { NextConfig } from 'next';

// STATIC_EXPORT=1 builds the GitHub Pages demo: no server, so the route
// handler (route.api.ts) is left out and the mock backend runs in the browser.
const isStatic = process.env.STATIC_EXPORT === '1';
const basePath = isStatic ? (process.env.PAGES_BASE_PATH ?? '/chat-fault-lab') : '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: isStatic ? ['tsx'] : ['tsx', 'api.ts'],
  ...(isStatic ? { output: 'export' as const, basePath, trailingSlash: true, images: { unoptimized: true } } : {}),
  env: {
    NEXT_PUBLIC_TRANSPORT: isStatic ? 'browser' : 'server',
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
