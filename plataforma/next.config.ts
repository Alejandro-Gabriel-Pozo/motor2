import path from "node:path";
import type { NextConfig } from "next";
import { cabecerasComunes } from "../src/core/seguridad/cabeceras";

// La consola importa módulos puros del núcleo (`../src/core/...`): el bundler y el trazado de archivos de Vercel parten de la raíz del repositorio.
const raiz = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: { root: raiz },
  outputFileTracingRoot: raiz,
  poweredByHeader: false,
  // La CSP con nonce la pone `src/proxy.ts`; acá van las comunes (HSTS, nosniff, sin marcos), la prohibición de indexar y la de cachear.
  async headers() {
    return [{ source: "/:path*", headers: [...cabecerasComunes(), { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] }];
  },
};

export default nextConfig;
