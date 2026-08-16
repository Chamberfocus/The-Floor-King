import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf bundles its own pdf.js; keep it external so the serverless function
  // loads it at runtime instead of trying to bundle it.
  // ssh2 (under ssh2-sftp-client, used to collect supplier 832 price catalogs)
  // ships a native crypto binding that can't go in an ESM chunk at all — it
  // must be loaded at runtime by Node, not bundled.
  serverExternalPackages: ["unpdf", "ssh2", "ssh2-sftp-client"],
  // Allow larger uploads through Server Actions (price-list / client PDFs,
  // order confirmations, vendor bills, logos). Default is 1 MB.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
