import type { Prisma } from "@prisma/client";

/**
 * Persistencia de las validaciones de `registrarMovimiento` que corren ANTES de abrir la transacción (Task #41, Fase M, M13a —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Son EXACTAMENTE las lecturas de Prisma que antes hacía en línea la Server Action
 * `registrarMovimiento` (src/server/actions/movimientos/movimientos.ts), copiadas tal cual; qué hacer con lo cargado (mensajes,
 * cuándo llamarlas) lo decide el caso de uso `casos-de-uso/registrar-movimiento.ts`. Sin reglas de negocio.
 *
 * Contrato: el cliente es SIEMPRE el primer parámetro, obligatorio (nunca `db = prisma` por defecto) — salvo la excepción documentada
 * acá, calcada del docstring de `guardar-version-de-receta.ts` de P1: estas tres lecturas corren FUERA de la transacción, con el
 * cliente GLOBAL `prisma` (es el camino rápido previo a la SERIALIZABLE; el árbitro real es un índice único o la propia
 * transacción — nunca esta lectura sola). El caso de uso les pasa el cliente global a propósito.
 */

/** `null` si el motivo no existe. Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarMotivoMerma(db: Prisma.TransactionClient, motivoId: string): Promise<{ activo: boolean } | null> {
  const motivo = await db.motivoMerma.findUnique({ where: { id: motivoId } });
  if (!motivo) return null;
  return { activo: motivo.activo };
}

/** `null` si el destino no existe. Corre FUERA de la transacción (ver el docstring del archivo). */
export async function cargarDestinoConsumo(db: Prisma.TransactionClient, destinoId: string): Promise<{ activo: boolean } | null> {
  const destino = await db.destinoConsumo.findUnique({ where: { id: destinoId } });
  if (!destino) return null;
  return { activo: destino.activo };
}

/**
 * true si ya existe una Compra VIGENTE (no anulada) con ese proveedor + N.º de factura en esta sucursal (Movimientos.js:402-416).
 * Camino RÁPIDO previo a la SERIALIZABLE — ver el docstring del archivo: bajo concurrencia real el árbitro es el índice único parcial
 * `Operacion_factura_unica_vigente_key`, no esta lectura.
 */
export async function existeCompraVigenteConFactura(
  db: Prisma.TransactionClient,
  args: { sucursalId: string; proveedorId: string; nroFactura: string }
): Promise<boolean> {
  const yaExiste = await db.operacion.findFirst({
    where: { sucursalId: args.sucursalId, proceso: "COMPRA", proveedorId: args.proveedorId, nroFactura: args.nroFactura, anuladaEn: null },
  });
  return !!yaExiste;
}
