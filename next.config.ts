import type { NextConfig } from "next";

// basePath MUST equal the Webflow Cloud mount path (/e). Route handlers live
// at app/v, app/collect, etc. and serve publicly as popfly.com/e/v, /e/collect.
const nextConfig: NextConfig = {
  basePath: "/e",
  assetPrefix: "/e",
};

export default nextConfig;
