/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output -> a self-contained server for Docker/PaaS deploys.
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@libsql/client"],
  // Allow large plant manuals/drawings through (route enforces the real 50 MB
  // per-file cap). Without this, big multipart PDF uploads can be rejected.
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
