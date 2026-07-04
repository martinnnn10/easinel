/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output -> a self-contained server for Docker/PaaS deploys.
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@libsql/client"],
  // Allow large file uploads (manuals, drawings) to pass through middleware
  // without truncation. nginx is already set to 50m; match here.
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
