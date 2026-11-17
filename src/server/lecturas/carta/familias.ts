import "server-only";
import { productosOcultosEn } from "@/server/lecturas/catalogo/ocultamiento";
import type { Db } from "@/lib/db-tipos";

/**
 * Consulta de GESTIÓN de las familias de productos (etapa F1, docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md, §9): la lista de las familias de la empresa y la ficha de una, con sus miembros vigentes y, por cada
 * miembro, las banderas «desactivado», «oculto» y «sin medidas». Solo lee. La familia es de la EMPRESA: la RLS (`aislamiento_empresa`) la deja ver solo a su empresa, y una familia de otra empresa responde igual que una
 * que no existe (`null`). Las banderas dependen de la sucursal ACTIVA (`sucursalId`, la del contexto del servidor, nunca del frontend): desactivado = sin disponibilidad prendida en esa sucursal; oculto = la regla única
 * `ocultoPor` (`productosOcultosEn`). Sin guarda de permiso adentro: la pone quien la llama. Nada de lo que devuelve decide cómo se ve la familia en pantalla (eso lo decide la función pura `formaDeSalir`); lo que falta no se
 * inventa: un miembro sin medidas lo dice la bandera, no un valor por defecto.
 */

/** Una familia en la lista. `miembrosVigentes` cuenta solo los que no se quitaron. */
export interface FamiliaEnLaLista {
  id: string;
  nombre: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
  activa: boolean;
  /** La versión que hay que devolver al editarla, desactivarla o quitarle un producto. */
  version: number;
  miembrosVigentes: number;
}

/** Las familias de la empresa, por nombre (las desactivadas también: nunca se borran). */
export async function listarFamiliasDeProducto(db: Db): Promise<FamiliaEnLaLista[]> {
  const filas = await db.familiaDeProducto.findMany({
    select: { id: true, nombre: true, agruparEnCarta: true, agruparEnPos: true, activa: true, version: true, _count: { select: { miembros: { where: { quitadoEn: null } } } } },
    orderBy: [{ nombre: "asc" }, { id: "asc" }],
  });
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, agruparEnCarta: f.agruparEnCarta, agruparEnPos: f.agruparEnPos, activa: f.activa, version: f.version, miembrosVigentes: f._count.miembros }));
}

/** Un miembro vigente en la ficha, con sus banderas (en la sucursal activa). */
export interface MiembroEnLaFicha {
  productoId: string;
  nombre: string;
  posicion: number;
  /** No está disponible en la sucursal (sin fila de disponibilidad = no disponible, como en la carta). */
  desactivado: boolean;
  /** Oculto en la sucursal (marca de la sucursal o de toda la empresa). */
  oculto: boolean;
  /** La familia tiene productos con medidas y este no tiene ninguna. */
  sinMedidas: boolean;
}

/** La ficha de una familia: sus datos y sus miembros vigentes por posición. */
export interface FichaDeFamilia extends FamiliaEnLaLista {
  miembros: MiembroEnLaFicha[];
}

/** La ficha de la familia con las banderas de la sucursal; `null` si no es de la empresa (o no existe). */
export async function consultarFichaDeFamilia(db: Db, args: { sucursalId: string; familiaId: string }): Promise<FichaDeFamilia | null> {
  const familia = await db.familiaDeProducto.findUnique({
    where: { id: args.familiaId },
    select: {
      id: true,
      nombre: true,
      agruparEnCarta: true,
      agruparEnPos: true,
      activa: true,
      version: true,
      miembros: { where: { quitadoEn: null }, orderBy: { posicion: "asc" }, select: { posicion: true, productoId: true, producto: { select: { nombre: true } } } },
    },
  });
  if (!familia) return null;
  const ids = familia.miembros.map((m) => m.productoId);
  const [disponibles, ocultos, conMedidas] = await Promise.all([
    ids.length === 0 ? [] : db.disponibilidadProducto.findMany({ where: { sucursalId: args.sucursalId, productoId: { in: ids }, disponible: true }, select: { productoId: true } }),
    productosOcultosEn(args.sucursalId, ids, db),
    // Productos con al menos un grupo de MEDIDA admitido y activo (el grupo y la admisión activos).
    ids.length === 0 ? [] : db.productoAdmiteGrupo.findMany({ where: { productoId: { in: ids }, activo: true, grupo: { tipo: "MEDIDA", activo: true } }, select: { productoId: true } }),
  ]);
  const disponiblesSet = new Set(disponibles.map((d) => d.productoId));
  const conMedidasSet = new Set(conMedidas.map((m) => m.productoId));
  const algunoConMedidas = conMedidasSet.size > 0;
  return {
    id: familia.id,
    nombre: familia.nombre,
    agruparEnCarta: familia.agruparEnCarta,
    agruparEnPos: familia.agruparEnPos,
    activa: familia.activa,
    version: familia.version,
    miembrosVigentes: familia.miembros.length,
    miembros: familia.miembros.map((m) => ({
      productoId: m.productoId,
      nombre: m.producto.nombre,
      posicion: m.posicion,
      desactivado: !disponiblesSet.has(m.productoId),
      oculto: ocultos.has(m.productoId),
      sinMedidas: algunoConMedidas && !conMedidasSet.has(m.productoId),
    })),
  };
}
