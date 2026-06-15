import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf bundles its own pdf.js; keep it external so the serverless function
  // loads it at runtime instead of trying to bundle it.
  serverExternalPackages: ["unpdf"],
  // Allow larger uploads through Server Actions (price-list / client PDFs,
  // order confirmations, vendor bills, logos). Default is 1 MB.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
