import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Silencia el warning de Turbopack: hay otro package-lock.json en la raíz
  // del repo (motor/), del tooling de Apps Script (clasp/gen-wrappers.js) —
  // no tiene nada que ver con este proyecto Next.js.
  turbopack: {
    root: __dirname,
  },
  // ADR-006: /catalogo/carta pasó a /carta (carta como módulo propio, ya
  // no anidada bajo catálogo). No permanente a propósito: si el destino
  // cambia de nuevo más adelante, un 308 cacheado por el navegador sería
  // más difícil de corregir que un 307.
  async redirects() {
    return [{ source: "/catalogo/carta/:path*", destination: "/carta/:path*", permanent: false }];
  },
};

// Sin SENTRY_AUTH_TOKEN configurado (no hay token de source maps
// provisionado todavía) — el build igual funciona, solo sin subir source
// maps, así que los stack traces en Sentry se ven minificados hasta que
// se agregue ese token.
export default withSentryConfig(nextConfig, {
  org: "zuluhub",
  project: "motor2",
  silent: true,
});
