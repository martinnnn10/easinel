/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output -> a self-contained server for Docker/PaaS deploys.
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@libsql/client"],
};

export default nextConfig;
