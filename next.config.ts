import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silencia el warning de Turbopack: hay otro package-lock.json en la raíz
  // del repo (motor/), del tooling de Apps Script (clasp/gen-wrappers.js) —
  // no tiene nada que ver con este proyecto Next.js.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
