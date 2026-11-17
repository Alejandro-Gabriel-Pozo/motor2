import type { ExcepcionDeAuditoria } from "../src/core/seguridad/auditoria-dependencias";

/**
 * Avisos de `npm audit` (severidad alta) que se aceptan, cada uno con su motivo y una fecha límite. Al vencer, `npm run
 * auditar:dependencias` vuelve a fallar: se revisa si Prisma ya publicó una versión sin el aviso, o se renueva la fecha con el
 * motivo vigente. Nunca se baja el umbral del comando para que pase.
 */
export const EXCEPCIONES_DE_AUDITORIA: ExcepcionDeAuditoria[] = [];
