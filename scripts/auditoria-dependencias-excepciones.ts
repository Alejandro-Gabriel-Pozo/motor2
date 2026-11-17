import type { ExcepcionDeAuditoria } from "../src/core/seguridad/auditoria-dependencias";

/**
 * Avisos de `npm audit` (severidad alta) que se aceptan, cada uno con su motivo y una fecha límite. Al vencer, `npm run
 * auditar:dependencias` vuelve a fallar: se revisa si Prisma ya publicó una versión sin el aviso, o se renueva la fecha con el
 * motivo vigente. Nunca se baja el umbral del comando para que pase.
 */
export const EXCEPCIONES_DE_AUDITORIA: ExcepcionDeAuditoria[] = [
  {
    aviso: "GHSA-fc5q-39xc-vjpf",
    paquete: "picomatch",
    motivo:
      "ReDoS de picomatch con extglobs repetidos (publicado el 2026-11-17). Afecta a TODAS las versiones publicadas hasta la 4.0.7 (la última): no hay versión corregida a la que subir. Entra solo por la herramienta de empaquetado de @sentry/nextjs (@rollup/plugin-commonjs, en tiempo de build), que compara rutas de archivos del propio repositorio con patrones fijos; ningún dato de usuario llega a picomatch en tiempo de ejecución. Se revisa cuando picomatch publique una versión corregida.",
    venceElDia: "2026-12-01",
  },
];
