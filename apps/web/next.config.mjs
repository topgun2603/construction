/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles only the server files the container needs, but it
  // builds that bundle out of symlinks — which Windows refuses without Developer
  // Mode or an elevated shell, so a local `next build` dies with EPERM. It is only
  // needed for the image, so infra/Dockerfile.web opts in and everyone else does not.
  output: process.env['NEXT_OUTPUT_STANDALONE'] === 'true' ? 'standalone' : undefined,
  // `@sitebook/shared` ships TypeScript-built CommonJS from the workspace; Next has
  // to compile it rather than treat it as an external package.
  transpilePackages: ['@sitebook/shared'],
  // The dev badge defaults to bottom-left, right on top of the plan card in the
  // navigation rail. Dev-only, but it makes the rail unreadable while working.
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
