import type { NextConfig } from "next";
import path from "path";
import { withWorkflow } from "workflow/next";

console.log("Social Blade build credential status", {
  clientIdHasValue: Boolean(process.env.SOCIAL_BLADE_CLIENT_ID?.trim()),
  tokenHasValue: Boolean(process.env.SOCIAL_BLADE_TOKEN?.trim()),
});

const nextConfig: NextConfig = {
  // Fix the "multiple lockfiles" issue by explicitly setting the project root
  outputFileTracingRoot: path.join(__dirname),
  // The Codex preview panel reaches the local dev server through the Mac's LAN address.
  allowedDevOrigins: ["127.0.0.1", "192.168.68.64"],
};

export default withWorkflow(nextConfig);
