/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  agentRules: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.metahub.space' },
      { protocol: 'https', hostname: 'episodes.metahub.space' },
      { protocol: 'https', hostname: 'media.kitsu.app' },
      { protocol: 'https', hostname: 'static.tvmaze.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'example.test' },
    ],
  },
};

export default nextConfig;
