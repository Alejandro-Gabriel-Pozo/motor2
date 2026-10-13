import "server-only";
import type { Prisma } from "@prisma/client";
import { cantidadesEfectivas, validarGrupo, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Las lecturas que los casos de uso del catálogo de opciones de venta (GO-2a) hacen DENTRO de su transacción SERIALIZABLE, compartidas (no es un caso de uso: ninguna Server
 * Action lo importa). Todo lo que decide se lee acá adentro, con el mismo `tx` que después escribe: si otra transacción cambia algo de lo leído antes del COMMIT, Postgres aborta
 * a una de las dos (40001) y el reintento relee (eso es lo que frena el «write skew» entre bajar el máximo de un grupo y fijarle a un producto un mínimo incompatible).
 *
 * `select` explícito siempre. Un id de otra empresa no se ve (RLS `aislamiento_empresa`): sale «no encontrado».
 */

type Tx = Prisma.TransactionClient;

export interface GrupoEnTx {
  id: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  activo: boolean;
  version: number;
}

export async function cargarGrupoEnTx(tx: Tx, grupoId: string): Promise<GrupoEnTx | null> {
  const g = await tx.grupoDeOpciones.findFirst({
    where: { id: grupoId },
    select: { id: true, nombre: true, tipo: true, cantidadMinima: true, cantidadMaxima: true, activo: true, version: true },
  });
  return g ? { ...g, tipo: g.tipo as TipoDeGrupoDeOpciones } : null;
}

/** Otro grupo de la empresa con ese nombre sin distinguir mayúsculas (el único `lower(nombre)` de la base), o `null`. */
export async function grupoConElMismoNombre(tx: Tx, nombre: string, exceptoId: string | null) {
  return tx.grupoDeOpciones.findFirst({
    where: { nombre: { equals: nombre, mode: "insensitive" }, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    select: { id: true, nombre: true, tipo: true, cantidadMinima: true, cantidadMaxima: true },
  });
}

/** Otra opción del grupo con ese nombre sin distinguir mayúsculas (el único `(grupoId, lower(nombre))`), o `null`. */
export async function opcionConElMismoNombre(tx: Tx, grupoId: string, nombre: string, exceptoId: string | null) {
  return tx.opcionDeGrupo.findFirst({
    where: { grupoId, nombre: { equals: nombre, mode: "insensitive" }, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
    select: { id: true, nombre: true, esNinguna: true, productoId: true },
  });
}

/**
 * Las admisiones ACTIVAS de un grupo (qué productos lo admiten y con qué cantidades propias), con las filas de sus opciones. Las lee la edición de un grupo o de una opción para
 * no dejar un producto con cantidades incoherentes y para avisar (D-4) a cuántos productos les queda un grupo obligatorio sin poder elegirse.
 */
export async function admisionesActivasDelGrupo(tx: Tx, grupoId: string) {
  const [admisiones, filasDeOpciones] = await Promise.all([
    tx.productoAdmiteGrupo.findMany({
      where: { grupoId, activo: true },
      select: { productoId: true, cantidadMinima: true, cantidadMaxima: true, producto: { select: { nombre: true } } },
    }),
    tx.productoAdmiteOpcion.findMany({
      where: { activo: true, opcion: { grupoId } },
      select: { productoId: true, opcionId: true, cantidadMaxima: true },
    }),
  ]);
  return admisiones.map((a) => ({ ...a, opciones: filasDeOpciones.filter((o) => o.productoId === a.productoId) }));
}

export type AdmisionActivaDelGrupo = Awaited<ReturnType<typeof admisionesActivasDelGrupo>>[number];

/** El primer producto que, con las cantidades nuevas del grupo, quedaría con cantidades EFECTIVAS incoherentes con el tipo (su mínimo propio por encima del máximo nuevo, …). */
export function productoConCantidadesIncoherentes(
  tipo: TipoDeGrupoDeOpciones,
  grupo: { cantidadMinima: number; cantidadMaxima: number },
  admisiones: readonly AdmisionActivaDelGrupo[]
): { nombre: string; mensaje: string } | null {
  for (const a of admisiones) {
    const r = validarGrupo({ tipo, ...cantidadesEfectivas({ tipo, ...grupo }, a) });
    if (!r.ok) return { nombre: a.producto.nombre, mensaje: r.mensaje };
  }
  return null;
}

/**
 * D-4: cuántos productos que admiten el grupo quedan SIN PODER VENDERSE con el estado nuevo (el grupo apagado y obligatorio para ellos, o su mínimo inalcanzable con las opciones
 * activas que admiten). No se bloquea: se avisa en el mensaje. `opcionesActivas`: cuáles de las opciones del grupo quedan activas para toda la empresa.
 */
export function productosSinPoderVenderse(
  grupo: { tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; activo: boolean },
  admisiones: readonly AdmisionActivaDelGrupo[],
  opcionesActivas: ReadonlySet<string>
): number {
  let afectados = 0;
  for (const a of admisiones) {
    const { cantidadMinima } = cantidadesEfectivas(grupo, a);
    if (cantidadMinima === 0) continue;
    const alcanzable = a.opciones.filter((o) => opcionesActivas.has(o.opcionId)).reduce((suma, o) => suma + o.cantidadMaxima, 0);
    if (!grupo.activo || alcanzable < cantidadMinima) afectados++;
  }
  return afectados;
}

/** Las opciones del grupo activas para toda la empresa (ids). */
export async function opcionesActivasDelGrupo(tx: Tx, grupoId: string): Promise<Set<string>> {
  return new Set((await tx.opcionDeGrupo.findMany({ where: { grupoId, activa: true }, select: { id: true } })).map((o) => o.id));
}

/** El aviso de D-4 para el mensaje de éxito («» si ninguno). */
export function avisoDeProductosAfectados(n: number): string {
  if (n === 0) return "";
  return n === 1
    ? " Atención: 1 producto que lo admite queda sin poder venderse hasta que elijas otra opción o cambies su configuración."
    : ` Atención: ${n} productos que lo admiten quedan sin poder venderse hasta que elijas otra opción o cambies su configuración.`;
}
