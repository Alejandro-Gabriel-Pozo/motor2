import "server-only";
import type { Prisma } from "@prisma/client";
import {
  cantidadesEfectivas,
  validarGrupo,
  type AdmisionParaSerBase,
  type ConsumoDeConfiguracion,
  type ContenidoDeVersion,
  type DiferenciaDePrecio,
  type EfectoDeConsumoDeOpcion,
  type ModoDePrecioDeMedida,
  type TipoDeGrupoDeOpciones,
} from "@/core/opciones/public";

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
  return idsDeProductosSinPoderVenderse(grupo, admisiones, opcionesActivas).length;
}

/** Los productos de `productosSinPoderVenderse` (sus ids): archivar un lote de «Limpiar» que toca varios grupos cuenta cada producto una sola vez. */
export function idsDeProductosSinPoderVenderse(
  grupo: { tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; activo: boolean },
  admisiones: readonly AdmisionActivaDelGrupo[],
  opcionesActivas: ReadonlySet<string>
): string[] {
  const afectados: string[] = [];
  for (const a of admisiones) {
    const { cantidadMinima } = cantidadesEfectivas(grupo, a);
    if (cantidadMinima === 0) continue;
    const alcanzable = a.opciones.filter((o) => opcionesActivas.has(o.opcionId)).reduce((suma, o) => suma + o.cantidadMaxima, 0);
    if (!grupo.activo || alcanzable < cantidadMinima) afectados.push(a.productoId);
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

// ───────────────────────────── Opciones y versiones ─────────────────────────────

export interface OpcionEnTx {
  id: string;
  grupoId: string;
  nombre: string;
  orden: number;
  activa: boolean;
  esNinguna: boolean;
  productoId: string | null;
  version: number;
  grupo: { nombre: string; tipo: TipoDeGrupoDeOpciones };
}

export async function cargarOpcionEnTx(tx: Tx, opcionId: string): Promise<OpcionEnTx | null> {
  const o = await tx.opcionDeGrupo.findFirst({
    where: { id: opcionId },
    select: { id: true, grupoId: true, nombre: true, orden: true, activa: true, esNinguna: true, productoId: true, version: true, grupo: { select: { nombre: true, tipo: true } } },
  });
  return o ? { ...o, grupo: { nombre: o.grupo.nombre, tipo: o.grupo.tipo as TipoDeGrupoDeOpciones } } : null;
}

export interface VersionVigenteEnTx extends ContenidoDeVersion {
  id: string;
  numero: number;
  creadoPorId: string;
}

/** La versión VIGENTE de una opción (la de número mayor, derivada), con sus consumos en orden, en números planos; `null` si todavía no tiene. */
export async function versionVigenteEnTx(tx: Tx, opcionId: string): Promise<VersionVigenteEnTx | null> {
  const v = await tx.versionDeOpcion.findFirst({
    where: { opcionId },
    orderBy: { numero: "desc" },
    select: {
      id: true,
      numero: true,
      tipoDeDiferencia: true,
      diferenciaPrecio: true,
      porcentaje: true,
      factorEscala: true,
      creadoPorId: true,
      consumos: {
        orderBy: { orden: "asc" },
        select: { efecto: true, insumoProductoId: true, reemplazaAProductoId: true, cantidad: true, mermaPorcentaje: true, escalaConLaMedida: true },
      },
    },
  });
  if (!v) return null;
  const diferencia: DiferenciaDePrecio = v.tipoDeDiferencia === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: Number(v.porcentaje) } : { tipo: "MONTO", monto: Number(v.diferenciaPrecio) };
  return {
    id: v.id,
    numero: v.numero,
    creadoPorId: v.creadoPorId,
    diferencia,
    factorEscala: v.factorEscala === null ? null : Number(v.factorEscala),
    consumos: v.consumos.map((c) => ({ ...c, efecto: c.efecto as EfectoDeConsumoDeOpcion, cantidad: Number(c.cantidad), mermaPorcentaje: Number(c.mermaPorcentaje) })),
  };
}

/**
 * Los insumos que nombran los consumos (el que se suma o reemplaza y el reemplazado de la base), leídos DENTRO de la transacción: cada uno tiene que ser una MATERIA PRIMA de la
 * empresa (un id de otra empresa no se ve: RLS). Cada consumo se guarda en la UNIDAD DE STOCK de su insumo (U7, como la receta: sin conversión), así que la unidad sale de acá y no
 * del cliente. Devuelve los consumos con su `unidadId` y los nombres para la auditoría, o el primer problema.
 */
export async function insumosDeLosConsumos(
  tx: Tx,
  consumos: readonly ConsumoDeConfiguracion[]
): Promise<{ ok: true; consumos: (ConsumoDeConfiguracion & { unidadId: string })[]; nombres: Map<string, string> } | { ok: false; mensaje: string }> {
  const ids = [...new Set(consumos.flatMap((c) => [c.insumoProductoId, ...(c.reemplazaAProductoId ? [c.reemplazaAProductoId] : [])]))];
  const productos = ids.length === 0 ? [] : await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, tipo: true, unidadStockId: true } });
  const porId = new Map(productos.map((p) => [p.id, p]));
  for (const [i, c] of consumos.entries()) {
    for (const id of [c.insumoProductoId, c.reemplazaAProductoId]) {
      if (id === null) continue;
      const p = porId.get(id);
      if (!p) return { ok: false, mensaje: `La línea ${i + 1} del consumo nombra un insumo que no se encontró.` };
      if (p.tipo !== "MP") return { ok: false, mensaje: `La línea ${i + 1} del consumo nombra «${p.nombre}», que no es una materia prima.` };
    }
  }
  return {
    ok: true,
    consumos: consumos.map((c) => ({ ...c, unidadId: porId.get(c.insumoProductoId)!.unidadStockId })),
    nombres: new Map(productos.map((p) => [p.id, p.nombre])),
  };
}

/** El resumen legible de los consumos de una versión, para la descripción de su auditoría («suma 0,2 de Leche; reemplaza Leche por Bebida de almendras (0,2)»). */
export function describirConsumos(consumos: readonly ConsumoDeConfiguracion[], nombres: ReadonlyMap<string, string>): string {
  if (consumos.length === 0) return "sin consumos";
  const nombre = (id: string) => `«${nombres.get(id) ?? id}»`;
  return consumos
    .map((c) => {
      const extra = `${c.mermaPorcentaje ? `, merma ${c.mermaPorcentaje} %` : ""}${c.escalaConLaMedida ? ", escala con el tamaño" : ""}`;
      return c.efecto === "SUMA" ? `suma ${c.cantidad} de ${nombre(c.insumoProductoId)}${extra}` : `reemplaza ${nombre(c.reemplazaAProductoId!)} por ${c.cantidad} de ${nombre(c.insumoProductoId)}${extra}`;
    })
    .join("; ");
}

/** Las columnas de la diferencia de una versión, como las guarda la base (para el antes y el después de la auditoría). */
export function columnasDeVersion(v: { diferencia: DiferenciaDePrecio; factorEscala: number | null } | null) {
  if (v === null) return { tipoDeDiferencia: null, diferenciaPrecio: null, porcentaje: null, factorEscala: null };
  return {
    tipoDeDiferencia: v.diferencia.tipo,
    diferenciaPrecio: v.diferencia.tipo === "MONTO" ? v.diferencia.monto : null,
    porcentaje: v.diferencia.tipo === "PORCENTAJE" ? v.diferencia.porcentaje : null,
    factorEscala: v.factorEscala,
  };
}

// ───────────────────────────── Fase 4: el producto que se vende por opción ─────────────────────────────

const diferenciaDeFilaDeProducto = (tipo: string | null, monto: unknown, porcentaje: unknown): DiferenciaDePrecio | null =>
  tipo === "MONTO" ? { tipo: "MONTO", monto: Number(monto) } : tipo === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: Number(porcentaje) } : null;

/**
 * Fase 4 de la ola «precio y carta» (ADR-035): TODO lo que el producto tiene asignado (cada grupo, activo o no en el producto, con sus opciones como las admite y la diferencia que rige: la del producto
 * si la sobrescribe, si no la de la versión vigente), en la forma de la regla pura de la base configurable (`rechazoDeAdmisionesDeBase`). Se lee con el mismo `tx` que después escribe: quien llama ya
 * tomó la fila del producto (`tomarFilaDeProducto`).
 */
export async function admisionesParaSerBase(tx: Tx, productoId: string): Promise<AdmisionParaSerBase[]> {
  const [grupos, filas] = await Promise.all([
    tx.productoAdmiteGrupo.findMany({
      where: { productoId },
      orderBy: [{ orden: "asc" }, { id: "asc" }],
      select: { activo: true, modoPrecio: true, grupo: { select: { nombre: true, tipo: true, activo: true, opciones: { orderBy: [{ orden: "asc" }, { id: "asc" }], select: { id: true, nombre: true, activa: true, esNinguna: true } } } } },
    }),
    tx.productoAdmiteOpcion.findMany({ where: { productoId }, select: { opcionId: true, activo: true, precioAbsoluto: true, tipoDeDiferencia: true, diferenciaPrecio: true, porcentaje: true } }),
  ]);
  const filaDe = new Map(filas.map((f) => [f.opcionId, f]));
  const admisiones: AdmisionParaSerBase[] = [];
  for (const g of grupos) {
    const opciones = [];
    for (const o of g.grupo.opciones) {
      const fila = filaDe.get(o.id);
      const delProducto = fila ? diferenciaDeFilaDeProducto(fila.tipoDeDiferencia, fila.diferenciaPrecio, fila.porcentaje) : null;
      // La versión vigente solo hace falta si el producto no sobrescribe la diferencia de una opción que ofrece.
      const deLaVersion = fila?.activo && o.activa && delProducto === null ? ((await versionVigenteEnTx(tx, o.id))?.diferencia ?? null) : null;
      opciones.push({
        nombre: o.nombre,
        activa: o.activa,
        admitida: fila?.activo ?? false,
        esNinguna: o.esNinguna,
        precioAbsoluto: fila?.precioAbsoluto == null ? null : Number(fila.precioAbsoluto),
        diferencia: delProducto ?? deLaVersion,
      });
    }
    admisiones.push({ grupo: { nombre: g.grupo.nombre, tipo: g.grupo.tipo as TipoDeGrupoDeOpciones, activo: g.grupo.activo }, activa: g.activo, modoPrecio: g.modoPrecio as ModoDePrecioDeMedida | null, opciones });
  }
  return admisiones;
}
