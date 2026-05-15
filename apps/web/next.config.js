/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BRIDGE_URL || "http://127.0.0.1:8787"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
