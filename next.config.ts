import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger uploads through Server Actions (price-list / client PDFs,
  // order confirmations, vendor bills, logos). Default is 1 MB.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
