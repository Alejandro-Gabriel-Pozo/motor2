import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de las PROMOS de la carta (`PromoCarta`, `PromoCartaSucursal`; Hito 4 de la pureza, bloque 4.2, pasos H4C-2 y H4C-3 — `docs/plan-hito-4-pureza.md`
 * §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio). Son EXACTAMENTE las
 * escrituras que antes hacía en línea `src/server/actions/carta/promos.ts`; las llaman los casos de uso de `src/server/actions/carta/casos-de-uso/`, que deciden
 * el cliente (la transacción del cambio junto con su auditoría) y auditan (la persistencia no audita: `escrituras-auditadas.test.ts` exige la cadena).
 */

/** Los datos editables de una promo de la empresa (sección, título, descripción, precio y orden). */
interface DatosDePromo {
  seccionCartaId: string;
  titulo: string;
  descripcion: string | null;
  precio: number;
  orden: number;
}

/** Cambia los datos de una promo existente (la edición: los cinco campos, siempre todos). */
export async function cambiarDatosDePromo(db: Prisma.TransactionClient, args: DatosDePromo & { id: string }): Promise<void> {
  await db.promoCarta.update({
    where: { id: args.id },
    data: { seccionCartaId: args.seccionCartaId, titulo: args.titulo, descripcion: args.descripcion, precio: args.precio, orden: args.orden },
  });
}

/**
 * Da de alta una promo de la empresa y la deja PRENDIDA en la sucursal desde la que se crea (su fila de `PromoCartaSucursal`, con los valores por defecto:
 * activa, sin precio local); las demás sucursales la prenden cuando quieran. Devuelve el id, para la auditoría.
 */
export async function crearPromoPrendidaEnSucursal(db: Prisma.TransactionClient, args: DatosDePromo & { sucursalId: string }): Promise<{ id: string }> {
  const creada = await db.promoCarta.create({
    data: {
      seccionCartaId: args.seccionCartaId,
      titulo: args.titulo,
      descripcion: args.descripcion,
      precio: args.precio,
      orden: args.orden,
      sucursales: { create: { sucursalId: args.sucursalId } },
    },
  });
  return { id: creada.id };
}

/**
 * Fija el precio de la promo en UNA sucursal (`null` = vuelve al precio de la empresa). Si la sucursal todavía no tenía fila, la crea APAGADA: el precio queda
 * guardado pero no la prende (prender es otra acción, con su propia clave).
 */
export async function fijarPrecioLocalDePromo(db: Prisma.TransactionClient, args: { promoCartaId: string; sucursalId: string; precioLocal: number | null }): Promise<void> {
  await db.promoCartaSucursal.upsert({
    where: { promoCartaId_sucursalId: { promoCartaId: args.promoCartaId, sucursalId: args.sucursalId } },
    create: { promoCartaId: args.promoCartaId, sucursalId: args.sucursalId, activa: false, precioLocal: args.precioLocal },
    update: { precioLocal: args.precioLocal },
  });
}
