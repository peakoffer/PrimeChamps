import type { NextConfig } from "next";
import path from "path";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Fix the "multiple lockfiles" issue by explicitly setting the project root
  outputFileTracingRoot: path.join(__dirname),
  // The Codex preview panel reaches the local dev server through the Mac's LAN address.
  allowedDevOrigins: ["127.0.0.1", "192.168.68.64"],
  // Vercel decrypts sensitive variables during the build, but this project's
  // runtime does not receive newly created sensitive values. These names are
  // referenced exclusively by a server route and are therefore emitted only
  // into its server bundle, never into a browser bundle.
  env: {
    SOCIAL_BLADE_CLIENT_ID: process.env.SOCIAL_BLADE_CLIENT_ID || "",
    SOCIAL_BLADE_TOKEN: process.env.SOCIAL_BLADE_TOKEN || "",
  },
};

export default withWorkflow(nextConfig);
