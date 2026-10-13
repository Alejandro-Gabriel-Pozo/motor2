import "server-only";
import type { Db } from "@/lib/db-tipos";

/** Cuántas huellas por producto se traen: tres botones, con margen para juntar la misma elección pedida con distintas versiones de precio. */
const HUELLAS_POR_PRODUCTO = 9;

/** Una configuración pedida en la sucursal: lo elegido DENTRO del precio (sin adicionales: no entran en la huella) y cuántas unidades se pidieron así. */
interface ConfiguracionPedida {
  elegidas: { opcionId: string; cantidad: number }[];
  unidades: number;
}

/**
 * GO-2d (ADR-030, «lo más pedido», modelo 3): de unos productos, las configuraciones que más se pidieron en las mesas de UNA sucursal desde `desde` (quien llama corta el día en la
 * zona de la empresa). Cuenta por `huellaOpciones` (la huella de lo elegido dentro del precio, con sus versiones e importes): las líneas originales de producto, sin espejos de
 * anulación ni adicionales, sumando sus unidades. Dos lecturas para todos los productos (el agregado y una línea de muestra por huella con su foto), sin N+1. Falla cerrado por
 * sucursal: la mesa de la cuenta tiene que ser de la sucursal pedida (en el mismo `where`), además de la RLS por sucursal.
 *
 * Devuelve, por producto, las configuraciones de mayor a menor (como mucho `HUELLAS_POR_PRODUCTO`: la misma elección con dos versiones de precio son dos huellas, y quien llama
 * las junta por elección y se queda con las tres primeras).
 */
export async function configuracionesMasPedidasEnSucursal(db: Db, sucursalId: string, productoIds: readonly string[], desde: Date): Promise<Map<string, ConfiguracionPedida[]>> {
  if (productoIds.length === 0) return new Map();
  const donde = { productoId: { in: [...new Set(productoIds)] }, huellaOpciones: { not: null }, anulaAItemId: null, lineaPadreId: null, creadoEn: { gte: desde }, cuenta: { mesa: { sucursalId } } };
  const grupos = await db.cuentaItem.groupBy({ by: ["productoId", "huellaOpciones"], where: donde, _sum: { cantidad: true } });
  const porProductoOrdenado = new Map<string, { huella: string; unidades: number }[]>();
  for (const g of grupos) {
    if (g.huellaOpciones === null) continue;
    porProductoOrdenado.set(g.productoId, [...(porProductoOrdenado.get(g.productoId) ?? []), { huella: g.huellaOpciones, unidades: Number(g._sum.cantidad ?? 0) }]);
  }
  const elegidas = [...porProductoOrdenado.values()].flatMap((lista) => lista.sort((a, b) => b.unidades - a.unidades || (a.huella < b.huella ? -1 : 1)).slice(0, HUELLAS_POR_PRODUCTO));
  if (elegidas.length === 0) return new Map();
  const muestras = await db.cuentaItem.findMany({
    where: { ...donde, huellaOpciones: { in: elegidas.map((e) => e.huella) } },
    distinct: ["huellaOpciones"],
    orderBy: [{ huellaOpciones: "asc" }, { id: "asc" }],
    // Una muestra por huella (`distinct`): el tope es la cantidad de huellas pedidas.
    take: elegidas.length,
    select: { huellaOpciones: true, opcionesElegidas: { where: { tipoGrupo: { not: "ADICIONAL" } }, orderBy: [{ orden: "asc" }, { id: "asc" }], select: { opcionId: true, cantidad: true } } },
  });
  const fotoDe = new Map(muestras.map((m) => [m.huellaOpciones!, m.opcionesElegidas]));
  const salida = new Map<string, ConfiguracionPedida[]>();
  for (const [productoId, lista] of porProductoOrdenado) {
    const top = lista.slice(0, HUELLAS_POR_PRODUCTO).flatMap((e) => {
      const foto = fotoDe.get(e.huella);
      return foto && foto.length ? [{ elegidas: foto.map((f) => ({ opcionId: f.opcionId, cantidad: f.cantidad })), unidades: e.unidades }] : [];
    });
    if (top.length) salida.set(productoId, top);
  }
  return salida;
}
