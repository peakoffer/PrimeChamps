import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Fix the "multiple lockfiles" issue by explicitly setting the project root
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
