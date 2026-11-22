import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // Le solveur HiGHS (WebAssembly) prévoit un chemin Node.js qu'il
      // n'emprunte pas dans le navigateur : on neutralise ces imports.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (r: { request: string }) => {
          r.request = r.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = { ...config.resolve.fallback, module: false, fs: false, crypto: false, path: false };
    }
    return config;
  },
};

export default nextConfig;
