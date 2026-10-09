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
 * Da de alta una promo de la empresa y le crea la fila de la sucursal desde la que se crea (`PromoCartaSucursal`, sin precio local): PRENDIDA si `prendida` (quien la crea
 * puede prender promos ALLÍ, `carta_promo_activar`) y APAGADA si no (S-10/D1, fila O.59: definir la promo es de la empresa, prenderla es de la sucursal). Las demás
 * sucursales la prenden cuando quieran. Devuelve el id, para la auditoría.
 */
export async function crearPromoEnSucursal(db: Prisma.TransactionClient, args: DatosDePromo & { sucursalId: string; prendida: boolean }): Promise<{ id: string }> {
  const creada = await db.promoCarta.create({
    data: {
      seccionCartaId: args.seccionCartaId,
      titulo: args.titulo,
      descripcion: args.descripcion,
      precio: args.precio,
      orden: args.orden,
      sucursales: { create: { sucursalId: args.sucursalId, activa: args.prendida } },
    },
  });
  return { id: creada.id };
}

/** Apagado (o prendido) GENERAL de la promo en la empresa: una promo apagada no se ofrece en ninguna sucursal, tenga lo que tenga cada una. */
export async function fijarActivaDePromo(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<void> {
  await db.promoCarta.update({ where: { id: args.id }, data: { activa: args.activa } });
}

/** Prende o apaga la promo en UNA sucursal (si la sucursal todavía no tenía fila, la crea con ese estado y sin precio local). */
export async function fijarActivaDePromoEnSucursal(db: Prisma.TransactionClient, args: { promoCartaId: string; sucursalId: string; activa: boolean }): Promise<void> {
  await db.promoCartaSucursal.upsert({
    where: { promoCartaId_sucursalId: { promoCartaId: args.promoCartaId, sucursalId: args.sucursalId } },
    create: { promoCartaId: args.promoCartaId, sucursalId: args.sucursalId, activa: args.activa },
    update: { activa: args.activa },
  });
}

/**
 * Reemplaza TODOS los cupos de la promo por la lista dada (todo o nada: lo llama el caso de uso dentro de su transacción). Una lista vacía deja la promo sin
 * cupos (informativa).
 */
export async function reemplazarCuposDePromo(
  db: Prisma.TransactionClient,
  args: { promoCartaId: string; cupos: readonly { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number; orden: number }[] },
): Promise<void> {
  await db.promoCartaCupo.deleteMany({ where: { promoCartaId: args.promoCartaId } });
  if (args.cupos.length) {
    await db.promoCartaCupo.createMany({
      data: args.cupos.map((c) => ({ promoCartaId: args.promoCartaId, seccionCartaId: c.seccionCartaId, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima, orden: c.orden })),
    });
  }
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
