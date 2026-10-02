import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de «registrar un pago a un proveedor de consignación» (Task #41, Fase M, M14 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Son EXACTAMENTE las lecturas y la escritura de Prisma que antes hacía en línea
 * `registrarPagoConsignante` (`src/server/actions/reportes/consignacion.ts`). Sin reglas de negocio.
 *
 * Contrato: el cliente es SIEMPRE el primer parámetro, obligatorio (nunca `db = prisma` por defecto) — acá las tres funciones corren
 * DENTRO de la misma transacción simple del caso de uso (a diferencia de otros dominios de Fase M, no hay ningún camino "fuera de tx"
 * acá: no hay ningún invariante de agregado que proteger, solo un insert con una clave única, así que no hace falta el camino rápido
 * previo a la transacción que sí usan `registrarMovimiento`/`reclasificarStock`).
 */

/** `null` si el proveedor no existe o está inactivo. */
export async function cargarProveedorActivo(db: Prisma.TransactionClient, proveedorId: string): Promise<{ id: string; nombre: string } | null> {
  const proveedor = await db.proveedor.findUnique({ where: { id: proveedorId } });
  if (!proveedor || !proveedor.activo) return null;
  return { id: proveedor.id, nombre: proveedor.nombre };
}

/** `null` si ningún pago tiene esa clave todavía. */
export async function cargarPagoConsignantePorClave(
  db: Prisma.TransactionClient,
  claveIdempotencia: string
): Promise<{ payloadHash: string | null; resultadoMensaje: string | null } | null> {
  return db.pagoConsignante.findUnique({
    where: { claveIdempotencia },
    select: { payloadHash: true, resultadoMensaje: true },
  });
}

export interface PagoConsignanteAEscribir {
  sucursalId: string;
  proveedorId: string;
  importe: number;
  fecha: Date;
  notas: string | undefined;
  usuarioId: string;
  claveIdempotencia: string | null;
  payloadHash: string | null;
  resultadoMensaje: string | null;
}

/**
 * Crea el pago con el mensaje de éxito YA incluido (Opción B) — a diferencia de `Operacion`, acá `resultadoMensaje` se conoce ANTES
 * del insert (proveedor e importe ya están resueltos), así que no hace falta un segundo `update` posterior.
 */
export async function crearPagoConsignante(tx: Prisma.TransactionClient, datos: PagoConsignanteAEscribir): Promise<{ id: string }> {
  const pago = await tx.pagoConsignante.create({
    data: {
      sucursalId: datos.sucursalId,
      proveedorId: datos.proveedorId,
      importe: datos.importe,
      fecha: datos.fecha,
      ...(datos.notas && { notas: datos.notas }),
      usuarioId: datos.usuarioId,
      claveIdempotencia: datos.claveIdempotencia,
      payloadHash: datos.payloadHash,
      resultadoMensaje: datos.resultadoMensaje,
    },
  });
  return { id: pago.id };
}
