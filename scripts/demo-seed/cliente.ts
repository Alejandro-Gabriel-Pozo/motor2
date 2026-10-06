import { dbDeEmpresa } from "../../src/core/auth/base";

/**
 * El cliente de las herramientas de demo y benchmark (ADR-022): ya no existe «la única empresa activa» como respaldo del DEFAULT de `empresaId`, así que estas herramientas
 * indican la empresa en la que siembran: `EMPRESA_ID` (por defecto `empresa_principal`, la que crea la migración). Cada operación corre con `app.empresa_id` fijado en su
 * propia transacción (`dbDeEmpresa`); estas herramientas no abren transacciones interactivas.
 */
export const prisma = dbDeEmpresa(process.env.EMPRESA_ID ?? "empresa_principal");
