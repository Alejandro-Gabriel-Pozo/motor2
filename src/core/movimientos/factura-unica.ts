import { Prisma } from "@prisma/client";

/**
 * Índice único parcial que arbitra la condición de carrera de factura de
 * compra duplicada (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
 * §9.2/§11): `ON "Operacion" ("sucursalId", "proveedorId", "nroFactura")
 * WHERE "nroFactura" IS NOT NULL AND proceso = 'COMPRA' AND "anuladaEn" IS NULL`.
 * Vive en una migración SQL escrita a mano (Prisma no declara índices parciales
 * en schema.prisma — ver el precedente en
 * prisma/migrations/20260915034450_indices_manuales/), no en el modelo
 * `Operacion`.
 *
 * Solo cuentan las compras VIGENTES: una compra anulada (K1c) deja libre su
 * N.º de factura, para poder anularla y volver a cargarla con el mismo número.
 * Nació sin ese predicado (`Operacion_factura_unica_key`, migración
 * 20260920220000) y se reemplazó en 20260921230000/20260921230100.
 */
export const NOMBRE_INDICE_FACTURA_UNICA = "Operacion_factura_unica_vigente_key";

/**
 * Nombres con los que Postgres puede reportar la violación. Incluye el índice VIEJO (sin filtro de anuladas) para que, en una base a medio
 * migrar (entre la migración que crea el nuevo y la que borra el viejo), el choque se siga reconociendo como «factura duplicada» y no salga como
 * un error 500.
 */
const NOMBRES_INDICE_FACTURA_UNICA: readonly string[] = [NOMBRE_INDICE_FACTURA_UNICA, "Operacion_factura_unica_key"];

/**
 * Mismo mensaje que el chequeo previo de `registrarMovimiento` (el camino
 * rápido, fuera de la transacción): el usuario no debe poder distinguir
 * "perdí una carrera contra otra carga simultánea" de "la factura ya
 * estaba cargada" — para él es el mismo hecho y la misma acción correctiva.
 */
export const MENSAJE_FACTURA_DUPLICADA = "Ya hay una compra registrada con esa factura para este proveedor. Si es una corrección, usá Ajuste en vez de volver a cargarla.";

/** El nombre del índice violado, si `e` trae uno reconocible (P2002 de Prisma o un DriverAdapterError crudo). */
function nombreDeIndiceViolado(e: unknown): string | undefined {
  // Forma real, confirmada empíricamente con @prisma/adapter-pg (Prisma 7, test/auditoria/factura-unica-concurrencia.test.ts):
  // un P2002 de PrismaClientKnownRequestError trae el DriverAdapterError original anidado en `meta.driverAdapterError`, no en
  // `meta.target` (que en esta versión viene vacío para un choque de índice parcial). Se revisan las dos formas por las
  // dudas — `esConflictoDeEscritura` en con-reintento.ts ya documenta que Prisma no es consistente en cómo expone esto.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = e.meta?.target;
    if (typeof target === "string" && target) return target;
    if (Array.isArray(target) && target.length) return String(target[0]);
    const anidado = nombreDeIndiceViolado(e.meta?.driverAdapterError);
    if (anidado) return anidado;
  }
  if (e && typeof e === "object" && "name" in e && (e as { name?: unknown }).name === "DriverAdapterError") {
    const cause = (e as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "kind" in cause && (cause as { kind?: unknown }).kind === "UniqueConstraintViolation") {
      const constraint = (cause as { constraint?: unknown }).constraint;
      if (constraint && typeof constraint === "object" && "index" in constraint) {
        const index = (constraint as { index?: unknown }).index;
        if (typeof index === "string") return index;
      }
    }
  }
  return undefined;
}

/**
 * Detecta ESPECÍFICAMENTE la violación del índice de factura única (`NOMBRES_INDICE_FACTURA_UNICA`) —
 * nunca "cualquier P2002": dentro de la misma transacción puede saltar la
 * violación de otro índice único (`Operacion_claveIdempotencia_key`, o
 * cualquier otro futuro) y disfrazarlo de "factura duplicada" sería
 * mentirle al usuario. Sin fallback a "cualquier P2002 sin nombre
 * reconocible": preferible que un caso no previsto salga como error 500
 * (visible, investigable) a que se lo confunda con este.
 */
export function esChoqueDeFacturaUnica(e: unknown): boolean {
  const nombre = nombreDeIndiceViolado(e);
  return nombre !== undefined && NOMBRES_INDICE_FACTURA_UNICA.includes(nombre);
}
