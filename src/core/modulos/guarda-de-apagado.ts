/**
 * La guarda de apagado de la recepción separada de compras (docs/diseno-compras-guarda-de-apagado-2026-11-17.md), del lado de la app: reconocer el rechazo que da la BASE y decir qué pasó. Puro: sin base ni imports.
 *
 * La regla la impone un disparador de la base (migración 20261117170000): apagar `recepcion_de_compras` con compras pendientes de recibir (de cualquier sucursal de la empresa) falla con SQLSTATE 23514, la restricción
 * `ModuloEmpresa_recepcion_pendientes_chk` y un mensaje `GUARDA_APAGADO_RECEPCION|<cantidad>|<sucursales>`. Las dos vías que apagan módulos (la consola y el script de emergencia) lo traducen con estas funciones al mismo texto.
 * Se reconoce por esa marca del mensaje (la forma exacta de la excepción depende del adaptador de Prisma, así que se mira el mensaje y la causa del driver). Una marca que no se puede leer entera NO se toma por un rechazo: el error sigue de largo.
 */

/** El único módulo con guarda de apagado: el que, apagado con partes pendientes, las dejaría sin forma de recibirse. */
export const MODULO_CON_GUARDA_DE_APAGADO = "recepcion_de_compras";

/** La acción de auditoría de plataforma de un apagado rechazado por la guarda. */
export const ACCION_DE_APAGADO_RECHAZADO = "modulo-desactivar-rechazado";

export interface ApagadoRechazadoPorComprasPendientes {
  /** Cuántas partes pendientes de recibir (no anuladas) hay en la empresa. 0 = la base no pudo comprobarlo y cerró (nivel de aislamiento distinto de READ COMMITTED). */
  cantidad: number;
  /** Nombres de las sucursales con pendientes (sin repetir, en orden alfabético). Vacío si `cantidad` es 0. */
  sucursales: string[];
}

const MARCA = /GUARDA_APAGADO_RECEPCION\|(\d{1,9})\|/;

/** Los textos donde puede venir el mensaje de la excepción: el del error y los de la causa del driver (`meta.driverAdapterError.cause`, `cause`). */
function textosDelError(e: unknown): string[] {
  if (!(e instanceof Error)) return [];
  const crudo: unknown[] = [e.message];
  const meta = (e as Error & { meta?: unknown }).meta as { driverAdapterError?: { cause?: unknown; message?: unknown } } | undefined;
  const causas: unknown[] = [meta?.driverAdapterError?.cause, meta?.driverAdapterError, (e as Error & { cause?: unknown }).cause];
  for (const c of causas) {
    if (c && typeof c === "object") {
      const o = c as { message?: unknown; originalMessage?: unknown };
      crudo.push(o.message, o.originalMessage);
    }
  }
  return crudo.filter((t): t is string => typeof t === "string");
}

/** `null` si `e` no es el rechazo de la guarda; si lo es, cuántas compras pendientes y en qué sucursales. */
export function apagadoRechazadoPorComprasPendientes(e: unknown): ApagadoRechazadoPorComprasPendientes | null {
  for (const texto of textosDelError(e)) {
    const m = MARCA.exec(texto);
    if (!m) continue;
    const cantidad = Number(m[1]);
    // Los nombres van desde la marca hasta el fin de la línea (el mensaje de Prisma los cierra con una comilla invertida).
    const linea = texto.slice(m.index + m[0].length).split("\n")[0] ?? "";
    const nombres = linea.endsWith("`") ? linea.slice(0, -1) : linea;
    const sucursales = cantidad === 0 ? [] : nombres.split(", ").map((s) => s.trim()).filter((s) => s.length > 0);
    return { cantidad, sucursales };
  }
  return null;
}

/** El texto del rechazo, igual en la consola y en el script. */
export function textoDeApagadoRechazado(r: ApagadoRechazadoPorComprasPendientes): string {
  if (r.cantidad === 0) return "No se puede apagar la recepción separada de compras: no se pudo comprobar si hay compras pendientes de recibir. Probá de nuevo.";
  const donde = r.sucursales.length > 0 ? ` (sucursales: ${r.sucursales.join(", ")})` : "";
  return `No se puede apagar la recepción separada de compras: hay ${r.cantidad} compra(s) pendientes de recibir${donde}. Recibilas o anulalas antes.`;
}
