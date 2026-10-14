import "server-only";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public";
import type { GrupoParaLimpiar, OpcionParaLimpiar, TipoDeGrupoDeOpciones, VentasRecientes } from "@/core/opciones/public";
import type { Db } from "@/lib/db-tipos";

/** Un día en milisegundos: los períodos de «sin ventas» se cuentan hacia atrás desde ahora, en instantes (30 × 24 h), sin depender de la zona. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

export interface OpcionParaLimpiarDelPanel extends OpcionParaLimpiar {
  esNinguna: boolean;
}

export interface GrupoParaLimpiarDelPanel extends GrupoParaLimpiar {
  tipo: TipoDeGrupoDeOpciones;
  opciones: OpcionParaLimpiarDelPanel[];
}

export interface DatosParaLimpiar {
  grupos: GrupoParaLimpiarDelPanel[];
  /** El nombre de cada producto que usa algún grupo en uso (para la vista previa «afecta a …»). */
  nombresDeProductos: Record<string, string>;
}

/**
 * La pantalla «Limpiar» de las opciones de venta (OPCIONES-LIMPIEZA, G2): los grupos EN USO y sus opciones EN USO, con qué productos los usan y si se vendieron en los últimos 30,
 * 90 y 180 días. Lo archivado ya no aparece (ya está limpio). Sin guarda adentro: la página exige el Editar de `opciones_definir` antes.
 *
 * Recibe la base de VERIFICACIÓN (`lecturaDeVerificacionEnLaEmpresa`: la lectura en TODAS las sucursales de la empresa, la escritura igual): «¿algún producto disponible en ALGUNA sucursal
 * lo usa?» y «¿se vendió en ALGUNA sucursal?» son preguntas de toda la empresa (con la base de la sucursal activa, una opción que se vende en otra sucursal saldría como «sin ventas» y se
 * propondría archivarla). De las ventas solo sale un sí o no por período: ni fechas, ni cantidades, ni sucursales. Cuatro consultas en paralelo, sin N+1.
 *
 * Un producto «usa» un grupo si la admisión está activa y el producto está disponible en alguna sucursal; usa una opción si además la admite (activa). Una venta es una línea con la
 * opción elegida (`OpcionElegidaEnLinea`), cobrada o no: cualquier uso cuenta (lo más prudente: menos candidatos).
 */
export async function listarCandidatosALimpiar(db: Db, ahora: Date): Promise<DatosParaLimpiar> {
  const hace = (dias: number) => new Date(ahora.getTime() - dias * UN_DIA_MS);
  const [grupos, admisiones, admisionesDeOpcion, ventas] = await Promise.all([
    db.grupoDeOpciones.findMany({
      where: { activo: true },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, tipo: true, opciones: { where: { activa: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { id: true, nombre: true, esNinguna: true } } },
    }),
    db.productoAdmiteGrupo.findMany({
      where: { activo: true, grupo: { activo: true }, producto: whereDisponibleEnAlguna() },
      select: { grupoId: true, producto: { select: { id: true, nombre: true } } },
    }),
    db.productoAdmiteOpcion.findMany({
      where: { activo: true, opcion: { activa: true, grupo: { activo: true } }, producto: whereDisponibleEnAlguna() },
      select: { productoId: true, opcionId: true, opcion: { select: { grupoId: true } } },
    }),
    db.opcionElegidaEnLinea.groupBy({ by: ["opcionId"], where: { creadoEn: { gte: hace(180) } }, _max: { creadoEn: true } }),
  ]);

  const nombresDeProductos: Record<string, string> = {};
  const productosDelGrupo = new Map<string, Set<string>>();
  for (const a of admisiones) {
    nombresDeProductos[a.producto.id] = a.producto.nombre;
    productosDelGrupo.set(a.grupoId, (productosDelGrupo.get(a.grupoId) ?? new Set()).add(a.producto.id));
  }
  // Una opción la usa un producto solo si el producto además usa su grupo (una fila de opción con el grupo quitado del producto no se ofrece).
  const productosDeLaOpcion = new Map<string, string[]>();
  for (const a of admisionesDeOpcion) {
    if (!productosDelGrupo.get(a.opcion.grupoId)?.has(a.productoId)) continue;
    productosDeLaOpcion.set(a.opcionId, [...(productosDeLaOpcion.get(a.opcionId) ?? []), a.productoId]);
  }
  const ultimaVenta = new Map(ventas.map((v) => [v.opcionId, v._max.creadoEn]));
  const ventasDe = (opcionId: string): VentasRecientes => {
    const ultima = ultimaVenta.get(opcionId)?.getTime() ?? null;
    return { d30: ultima !== null && ultima >= hace(30).getTime(), d90: ultima !== null && ultima >= hace(90).getTime(), d180: ultima !== null };
  };

  return {
    grupos: grupos.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      tipo: g.tipo as TipoDeGrupoDeOpciones,
      productoIds: [...(productosDelGrupo.get(g.id) ?? [])].sort(),
      opciones: g.opciones.map((o) => ({ id: o.id, nombre: o.nombre, esNinguna: o.esNinguna, productoIds: productosDeLaOpcion.get(o.id) ?? [], ventas: ventasDe(o.id) })),
    })),
    nombresDeProductos,
  };
}
