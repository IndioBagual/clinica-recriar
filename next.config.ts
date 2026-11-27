import type { NextConfig } from "next";

const netlifyBuildEnv: Record<string, string> = {};
if (process.env.DEPLOY_PRIME_URL) {
  netlifyBuildEnv.DEPLOY_PRIME_URL = process.env.DEPLOY_PRIME_URL;
}
if (process.env.CONTEXT) {
  netlifyBuildEnv.CONTEXT = process.env.CONTEXT;
}

const nextConfig: NextConfig = {
  ...(Object.keys(netlifyBuildEnv).length > 0 ? { env: netlifyBuildEnv } : {}),
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async rewrites() {
    return [
      {
        source: "/admin",
        destination: "/admin/index.html",
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/home",
        destination: "/unidades/tiradentes",
        statusCode: 301,
      },
      {
        source: "/unidade-abreu",
        destination: "/unidades/abreu",
        statusCode: 301,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;