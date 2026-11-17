import "server-only";
import type { Prisma } from "@prisma/client";
import { whereCartaDeSucursal } from "@/core/carta/public";

/**
 * Lecturas y escrituras de las FAMILIAS DE PRODUCTOS (`FamiliaDeProducto` y `MiembroDeFamilia`; etapa F1, docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md). Mismo contrato que el resto de `server/persistencia/`:
 * el `tx` de la transacción del caso de uso es el PRIMER parámetro, `data` literal, sin reglas de negocio ni auditoría (la escribe el caso de uso con el mismo `tx`). La familia es de la EMPRESA: no hay `where` de empresa
 * porque la RLS (`aislamiento_empresa`) y el `default` de `empresaId` la fijan desde el contexto del servidor, nunca desde el pedido. Los UPDATE tocan solo columnas con GRANT (la familia: `nombre`, `nombreClave`, los
 * interruptores, `activa`, `version`, `actualizadoEn`; el miembro: `quitadoPorId` y `quitadoEn`). Nada se borra.
 */

type Tx = Prisma.TransactionClient;

/** Lo que el caso de uso necesita saber de una familia. */
export interface FamiliaGuardada {
  id: string;
  nombre: string;
  nombreClave: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
  activa: boolean;
  version: number;
}

const SELECCION_DE_FAMILIA = { id: true, nombre: true, nombreClave: true, agruparEnCarta: true, agruparEnPos: true, activa: true, version: true } as const;

/** La familia por id, si es de la empresa (la RLS no deja ver la de otra). */
export async function leerFamiliaPorId(tx: Tx, id: string): Promise<FamiliaGuardada | null> {
  return tx.familiaDeProducto.findUnique({ where: { id }, select: SELECCION_DE_FAMILIA });
}

/** La familia de la empresa con esa clave de nombre (única por empresa), o `null`. */
export async function leerFamiliaPorNombreClave(tx: Tx, nombreClave: string): Promise<FamiliaGuardada | null> {
  return tx.familiaDeProducto.findFirst({ where: { nombreClave }, select: SELECCION_DE_FAMILIA });
}

/**
 * Toma la fila de la familia (`FOR UPDATE`) hasta el final de la transacción: dos pedidos a la vez sobre la MISMA familia (agregar, quitar, editar) se ordenan acá en vez de pisarse. No lee ni escribe datos.
 * Devuelve `false` si la familia no es de la empresa (la RLS no deja verla). Solo se bloquea la familia: el producto NO se bloquea por fila (el bloqueo por producto lo toma la propia base, dentro de los
 * disparadores del invariante transitorio con el ítem agrupado: una fila bloqueada acá y la clave foránea de la opción de un ítem agrupado formarían un ciclo de espera).
 */
export async function bloquearFamilia(tx: Tx, id: string): Promise<boolean> {
  const filas = await tx.$queryRaw<{ id: string }[]>`SELECT "id"::text AS "id" FROM "FamiliaDeProducto" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return filas.length === 1;
}

/** Alta de una familia: nace con los dos interruptores apagados y activa. El `id` lo manda la aplicación (uuid). */
export async function crearFamilia(tx: Tx, args: { id: string; nombre: string; nombreClave: string; actorId: string; ahora: Date }): Promise<void> {
  await tx.familiaDeProducto.create({
    data: { id: args.id, nombre: args.nombre, nombreClave: args.nombreClave, agruparEnCarta: false, agruparEnPos: false, activa: true, creadoPorId: args.actorId, creadoEn: args.ahora, actualizadoEn: args.ahora },
  });
}

/** Cambia los datos de una familia con control de versión. Devuelve `false` si la versión ya no es la esperada (alguien la cambió antes). */
export async function cambiarFamilia(
  tx: Tx,
  args: { id: string; versionEsperada: number; datos: { nombre?: string; nombreClave?: string; agruparEnCarta?: boolean; agruparEnPos?: boolean; activa?: boolean }; ahora: Date },
): Promise<boolean> {
  const { count } = await tx.familiaDeProducto.updateMany({
    where: { id: args.id, version: args.versionEsperada },
    data: { ...args.datos, version: args.versionEsperada + 1, actualizadoEn: args.ahora },
  });
  return count === 1;
}

/** El producto, si es de la empresa: su nombre y su tipo (el caso de uso exige que sea de venta). */
export async function leerProductoParaFamilia(tx: Tx, productoId: string): Promise<{ id: string; nombre: string; tipo: string } | null> {
  return tx.producto.findUnique({ where: { id: productoId }, select: { id: true, nombre: true, tipo: true } });
}

/** La pertenencia VIGENTE del producto (el miembro sin `quitadoEn`): en qué familia está y con qué posición. A lo sumo una (único parcial de la base). */
export async function leerMiembroVigenteDeProducto(tx: Tx, productoId: string): Promise<{ id: string; familiaId: string; posicion: number } | null> {
  return tx.miembroDeFamilia.findFirst({ where: { productoId, quitadoEn: null }, select: { id: true, familiaId: true, posicion: true } });
}

/** La pertenencia de un id de miembro cualquiera (vigente o quitada), por si un reintento manda el mismo `id` de fila. */
export async function leerMiembroPorId(tx: Tx, id: string): Promise<{ id: string; familiaId: string; productoId: string; quitado: boolean } | null> {
  const m = await tx.miembroDeFamilia.findUnique({ where: { id }, select: { id: true, familiaId: true, productoId: true, quitadoEn: true } });
  return m ? { id: m.id, familiaId: m.familiaId, productoId: m.productoId, quitado: m.quitadoEn !== null } : null;
}

/** Las posiciones de los miembros vigentes de la familia. */
export async function posicionesVigentes(tx: Tx, familiaId: string): Promise<number[]> {
  const filas = await tx.miembroDeFamilia.findMany({ where: { familiaId, quitadoEn: null }, select: { posicion: true } });
  return filas.map((f) => f.posicion);
}

/**
 * ¿El producto está en algún ítem agrupado de la carta de ESTA sucursal (activo o no)? Es el chequeo AMABLE del caso de uso (la carta de cada sucursal es propia, `whereCartaDeSucursal`, y la RLS por sucursal tampoco deja ver más). La RED es la base:
 * su disparador mira TODAS las sucursales de la empresa, sin alcance, y el caso de uso traduce su rechazo al mismo resultado.
 */
export async function productoEstaEnUnItemAgrupadoDeLaSucursal(tx: Tx, args: { sucursalId: string; productoId: string }): Promise<boolean> {
  return (await tx.opcionItemAgrupadoCarta.findFirst({ where: { ...whereCartaDeSucursal(args.sucursalId), productoId: args.productoId }, select: { id: true } })) !== null;
}

/** Alta de un miembro vigente. El `id` lo manda la aplicación (uuid). Si el producto ya es miembro de otra familia, o está en un ítem agrupado, la base rechaza. */
export async function crearMiembro(tx: Tx, args: { id: string; familiaId: string; productoId: string; posicion: number; actorId: string; ahora: Date }): Promise<void> {
  await tx.miembroDeFamilia.create({
    data: { id: args.id, familiaId: args.familiaId, productoId: args.productoId, posicion: args.posicion, agregadoPorId: args.actorId, agregadoEn: args.ahora },
  });
}

/** Quitar NO borra: escribe quién y cuándo. Devuelve `false` si el miembro ya estaba quitado (no escribe). */
export async function marcarMiembroQuitado(tx: Tx, args: { id: string; actorId: string; ahora: Date }): Promise<boolean> {
  const { count } = await tx.miembroDeFamilia.updateMany({ where: { id: args.id, quitadoEn: null }, data: { quitadoPorId: args.actorId, quitadoEn: args.ahora } });
  return count === 1;
}
