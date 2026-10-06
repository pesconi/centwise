import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    transpilePackages: ["@centwise/core", "@centwise/database", "@centwise/design-tokens"]
};

export default nextConfig;