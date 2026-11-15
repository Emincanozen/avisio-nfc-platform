/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @avisio/core est publié en TypeScript source : Next le compile lui-même.
  transpilePackages: ['@avisio/core'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  },
  webpack: (config) => {
    // Le paquet core utilise des spécificateurs ESM explicites (`./x.js`) qui
    // pointent vers des fichiers `.ts`. C'est la forme correcte pour Node ;
    // webpack a besoin qu'on le lui dise.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
