import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/v3/:path*",
        destination: "http://127.0.0.1:8000/api/v3/:path*",
      },
      {
        source: "/api/v1/:path*",
        destination: "http://127.0.0.1:8000/api/v1/:path*",
      },
      {
        source: "/api/v5/:path*",
        destination: "http://127.0.0.1:8000/api/v5/:path*",
      },
      {
        source: "/api/health",
        destination: "http://127.0.0.1:8000/api/health",
      },
      {
        source: "/health",
        destination: "http://127.0.0.1:8000/health",
      },
    ];
  },
};

export default nextConfig;
