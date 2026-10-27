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
export async function crearPromoEnSucursal(db: Prisma.TransactionClient, args: DatosDePromo & { sucursalId: string; prendida: boolean; soloSalon: boolean }): Promise<{ id: string }> {
  const creada = await db.promoCarta.create({
    data: {
      seccionCartaId: args.seccionCartaId,
      titulo: args.titulo,
      descripcion: args.descripcion,
      precio: args.precio,
      orden: args.orden,
      soloSalon: args.soloSalon,
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
 * GO-3b (ADR-032, D3): los cupos de una promo ya NO se borran (ni se reemplazan borrando): el caso de uso calcula la diferencia por clave natural (`diferenciaDeCupos`, `core/carta`) y
 * escribe con estas tres, dentro de su transacción. Un cupo nuevo se crea (devuelve su id, para la auditoría); uno que sigue o vuelve se cambia en el lugar y queda ACTIVO; uno que no
 * vino se da de baja (`activo = false`). Así las entradas de una lista y los platos del día nunca cuelgan de una fila borrada.
 */
export async function crearCupoDePromo(
  db: Prisma.TransactionClient,
  args: { promoCartaId: string; tipo: string; seccionCartaId: string | null; nombre: string | null; cantidadMinima: number; cantidadMaxima: number; orden: number },
): Promise<{ id: string }> {
  const creado = await db.promoCartaCupo.create({
    data: {
      promoCartaId: args.promoCartaId,
      tipo: args.tipo,
      seccionCartaId: args.seccionCartaId,
      nombre: args.nombre,
      cantidadMinima: args.cantidadMinima,
      cantidadMaxima: args.cantidadMaxima,
      orden: args.orden,
    },
    select: { id: true },
  });
  return { id: creado.id };
}

/** Deja ACTIVO un cupo que ya existía (sigue o vuelve), con sus cantidades, su orden y su nombre (el de un cupo de sección queda NULL). */
export async function cambiarCupoDePromo(
  db: Prisma.TransactionClient,
  args: { id: string; nombre: string | null; cantidadMinima: number; cantidadMaxima: number; orden: number },
): Promise<void> {
  await db.promoCartaCupo.update({ where: { id: args.id }, data: { activo: true, nombre: args.nombre, cantidadMinima: args.cantidadMinima, cantidadMaxima: args.cantidadMaxima, orden: args.orden } });
}

/** Da de baja un cupo (baja lógica: la fila queda, con sus entradas y sus platos del día). */
export async function darDeBajaCupoDePromo(db: Prisma.TransactionClient, args: { id: string }): Promise<void> {
  await db.promoCartaCupo.update({ where: { id: args.id }, data: { activo: false } });
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

/**
 * El interruptor «solo salón» de la promo con su control OPTIMISTA: escribe solo si la versión sigue siendo la que vio la pantalla, y la incrementa (la misma `version` que la vigencia). Devuelve cuántas filas cambió (0 = alguien la cambió entre medio:
 * `VERSION_DESACTUALIZADA`).
 */
export async function cambiarSoloSalonDePromo(db: Prisma.TransactionClient, args: { id: string; versionEsperada: number; soloSalon: boolean }): Promise<number> {
  const { count } = await db.promoCarta.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { soloSalon: args.soloSalon, version: { increment: 1 } },
  });
  return count;
}
