import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Adicione esta parte de rewrites
  async rewrites() {
    return [
      {
        source: '/admin',
        destination: '/admin/index.html',
      },
    ];
  },
};

export default nextConfig;