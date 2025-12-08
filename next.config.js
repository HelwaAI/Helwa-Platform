/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: {
    qualities: [75, 85],
  },
};

module.exports = nextConfig;
