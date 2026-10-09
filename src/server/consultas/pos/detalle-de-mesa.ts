import "server-only";
import { armarDetalleDeMesa, type DetalleDeMesa } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * La mesa pedida con su cuenta abierta (si tiene), agrupada por envío — una sola consulta. `null` si la mesa no existe o no es de esta sucursal (el aislamiento por
 * sucursal vive acá, no en quien llama). La lectura vive acá; el armado es puro y vive en `core/pos/cuenta.ts` (Pureza Fase 3). La pantalla de detalle la llama
 * después de su propia guarda de Ver de `pos_mesas`: sin guarda de permiso adentro. `ahora` es OBLIGATORIO (O.22-a, Hito 4): lo fija la pantalla en el borde.
 */
export async function obtenerDetalleDeMesa(sucursalId: string, mesaId: string, db: Db, ahora: Date): Promise<DetalleDeMesa | null> {
  const mesa = await db.mesa.findFirst({
    where: { id: mesaId, sucursalId },
    include: {
      cuentas: {
        where: { cerradaEn: null },
        include: {
          abiertaPor: { select: { name: true, email: true } },
          cliente: { select: { nombre: true } },
          items: {
            orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
            include: {
              producto: { select: { nombre: true, unidadStock: { select: { decimales: true } } } },
              creadoPor: { select: { name: true, email: true } },
              promoCuenta: { select: { id: true, titulo: true } },
            },
          },
        },
      },
    },
  });

  return armarDetalleDeMesa(
    mesa && {
      id: mesa.id,
      numero: mesa.numero,
      cuentas: mesa.cuentas.map((c) => ({
        id: c.id,
        abiertaEn: c.abiertaEn,
        comensales: c.comensales,
        clienteId: c.clienteId,
        cliente: c.cliente,
        descuentoPorcentaje: c.descuentoPorcentaje !== null ? Number(c.descuentoPorcentaje) : null,
        abiertaPor: c.abiertaPor,
        items: c.items.map((i) => ({
          id: i.id,
          productoId: i.productoId,
          producto: i.producto,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precioUnitario),
          precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
          numeroEnvio: i.numeroEnvio,
          anulaAItemId: i.anulaAItemId,
          motivoAnulacion: i.motivoAnulacion,
          creadoPor: i.creadoPor,
          creadoEn: i.creadoEn,
          promoCuenta: i.promoCuenta,
        })),
      })),
    },
    ahora,
  );
}
