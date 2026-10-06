import type { ExcepcionDeAuditoria } from "../src/core/seguridad/auditoria-dependencias";

/**
 * Avisos de `npm audit` (severidad alta) que se aceptan, cada uno con su motivo y una fecha límite. Al vencer, `npm run
 * auditar:dependencias` vuelve a fallar: se revisa si Prisma ya publicó una versión sin el aviso, o se renueva la fecha con el
 * motivo vigente. Nunca se baja el umbral del comando para que pase.
 */
export const EXCEPCIONES_DE_AUDITORIA: ExcepcionDeAuditoria[] = [
  {
    aviso: "GHSA-ggr8-5vv4-36mx",
    paquete: "deepmerge-ts",
    motivo: "Llega por `@prisma/config` del CLI de Prisma (se usa en el build y las migraciones, con configuración propia nuestra). La aplicación en ejecución no lo carga.",
    venceElDia: "2026-12-01",
  },
  {
    aviso: "GHSA-3f6p-5ww8-9rcr",
    paquete: "mysql2",
    motivo: "Driver de MySQL que trae el CLI de Prisma. Usamos PostgreSQL: el driver no se ejecuta ni en el build ni en producción.",
    venceElDia: "2026-12-01",
  },
];
