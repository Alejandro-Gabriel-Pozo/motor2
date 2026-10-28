import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
// OJO: estos dos son archivos HOJA a propósito y NO van por `core/carta/public.ts`: Next carga este archivo con Node, sin los alias de TypeScript (`@/…`), y la fachada arrastra media aplicación
// (`@/core/moneda`, `decimal.js`…): el build revienta con «Cannot find module». La regla `sin-internals-de-otro-dominio` lo exceptúa por eso (`.dependency-cruiser.cjs`).
import { patronHostZonaCarta, reglasRedirectAppACarta, reglasRedirectCarta, reglasRewriteCarta } from "./src/core/carta/host";
import { reglasRedirectEmpresaUnica, reglasRewriteEmpresaUnica } from "./src/core/carta/carta-empresa-unica";
import { sirvePorHttps } from "./src/core/auth/cookie-sesion";
import { CACHE_PUBLICO_DE_LA_CARTA, cabecerasCarta, cabecerasComunes, NO_INDEXAR } from "./src/core/seguridad/cabeceras";

const dominioBaseCarta = process.env.CARTA_DOMINIO_BASE?.trim().toLowerCase();

const nextConfig: NextConfig = {
  // S-32: sin `X-Powered-By: Next.js` (no anunciar el framework ni su versión a quien escanea).
  poweredByHeader: false,
  // ISR de la carta de una sucursal (`revalidate = 60`): `Cache-Control: s-maxage=60, stale-while-revalidate=300`. Sin esto el `stale-while-revalidate` es de un año y un CDN podría servir
  // una carta de hace meses mientras regenera. La aplicación (login, panel, POS) es dinámica y no usa ISR: este valor no la toca.
  expireTime: 360,
  // Copia de CARTA_DOMINIO_BASE tal como la vio el build (se incrusta en el bundle): `instrumentation.ts` la compara con la del arranque.
  env: { CARTA_DOMINIO_BASE_COMPILADO: dominioBaseCarta ?? "", CARTA_EMPRESA_UNICA_COMPILADO: process.env.CARTA_EMPRESA_UNICA ?? "" },
  // Silencia el warning de Turbopack: hay otro package-lock.json en la raíz
  // del repo (motor/), del tooling de Apps Script (clasp/gen-wrappers.js) —
  // no tiene nada que ver con este proyecto Next.js.
  turbopack: {
    root: __dirname,
  },
  // Cabeceras de seguridad (informe 2026-10-01, S-04). La CSP de la APP lleva nonce por pedido y la pone `src/proxy.ts`; acá van las
  // comunes a todo y la CSP estática de la carta (sin nonce, para que siga siendo ISR), por path directo y por su host. Si dos reglas
  // fijan la misma cabecera, gana la última: las de la carta van después. Lo mismo con `X-Robots-Tag`: la aplicación no se indexa jamás
  // (regla de todos los paths), la ruta técnica de la carta tampoco, y el host público de la carta SÍ (es lo que el negocio quiere que se encuentre).
  async headers() {
    const https = sirvePorHttps(process.env);
    return [
      { source: "/:path*", headers: cabecerasComunes() },
      { source: "/:path*", headers: [NO_INDEXAR] },
      { source: "/carta-publica/:path*", headers: cabecerasCarta({ https, indexable: false }) },
      // El portal es dinámico (siempre al día en Next) pero público: lo guarda la CDN 60 s. Solo el portal; la carta de una sucursal es ISR y Next arma su `Cache-Control`.
      { source: "/carta-publica/:empresa", headers: [CACHE_PUBLICO_DE_LA_CARTA] },
      ...(dominioBaseCarta
        ? [
            { source: "/:path*", has: [{ type: "host" as const, value: patronHostZonaCarta(dominioBaseCarta) }], headers: cabecerasCarta({ https, indexable: true }) },
            { source: "/", has: [{ type: "host" as const, value: patronHostZonaCarta(dominioBaseCarta) }], headers: [CACHE_PUBLICO_DE_LA_CARTA] },
          ]
        : []),
    ];
  },
  async redirects() {
    return [
      // Add-on CARTA_EMPRESA_UNICA (apagado sin la variable): antes que las del núcleo, gana la primera que coincide.
      ...reglasRedirectEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA),
      // En el host de la carta, los links internos /carta-publica/... se llevan a la URL limpia (ver reglasRedirectCarta).
      ...reglasRedirectCarta(process.env.CARTA_DOMINIO_BASE),
      // En cualquier otro host (el de la app), esos paths redirigen al host de la carta (ver reglasRedirectAppACarta).
      ...reglasRedirectAppACarta(process.env.CARTA_DOMINIO_BASE),
    ];
  },
  // ADR-006, Fase 6: <empresa>.<CARTA_DOMINIO_BASE> sirve la carta pública sin mostrar /carta-publica en la URL. Sin la variable
  // (leída al compilar) no hay reglas. `revalidatePath` sigue operando sobre el path destino, no sobre el host.
  async rewrites() {
    return { beforeFiles: [...reglasRewriteEmpresaUnica(process.env.CARTA_DOMINIO_BASE, process.env.CARTA_EMPRESA_UNICA), ...reglasRewriteCarta(process.env.CARTA_DOMINIO_BASE)] };
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
