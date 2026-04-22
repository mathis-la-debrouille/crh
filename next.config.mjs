/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent Next.js from bundling these server-only packages with native bindings
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "@prisma/adapter-libsql",
      "@libsql/client",
    ],
  },
};

export default nextConfig;
