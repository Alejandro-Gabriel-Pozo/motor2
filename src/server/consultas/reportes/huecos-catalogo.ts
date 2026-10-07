import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import type { ProblemaUnidadMezclada, ReporteHuecosCatalogo } from "@/core/reportes/public";

/**
 * Port de las primeras dos secciones de generarReporteHuecosCatalogo_
 * (Reportes.js:864-893; hallazgo M-7). La tercera sección (unidad
 * mezclada) queda en obtenerProblemasUnidadMezclada — abajo — porque en
 * Apps Script está gateada con 'insumos_mezclados' DENTRO del reporte; acá
 * ese gate vive en la capa de server action/página (mismo criterio que el
 * resto del proyecto: los módulos de src/core/ son agnósticos de permisos).
 *
 * 1) PV disponible EN ESTA SUCURSAL que nunca se vendió acá — no es un
 *    error (puede ser nuevo en el menú), es una señal para revisar
 *    precio/receta.
 * 2) MP disponible EN ESTA SUCURSAL, vinculada a una receta (se puede
 *    vender) pero sin ningún proveedor en el Catálogo Central — se puede
 *    recibir por Compra igual, pero "Comparar precios"/Alta rápida no
 *    tienen de dónde sacar referencia. Excluye las MP "Se produce"
 *    (`seProduce`) a propósito: esas se fabrican con su propia receta,
 *    nunca se compran, así que no tener proveedor no es un hueco — es lo
 *    esperado. Falso positivo real encontrado probando la demo
 *    (docs/comparativa-ux-erpnext-dolibarr.md §8.7): "Prepizza masa
 *    chica/grande" aparecían acá sin corresponder.
 */
export async function generarReporteHuecosCatalogo(sucursalId: string, db: Db): Promise<ReporteHuecosCatalogo> {
  const productos = await construirMapaProductos(sucursalId, db);
  const { mpsEnRecetas } = await construirIndiceRecetas(db);

  const vendidos = await db.movimientoStock.findMany({
    // Una venta ANULADA no cuenta como «vendido alguna vez».
    where: { proceso: "VENTA", seccion: { sucursalId }, operacion: { anuladaEn: null } },
    select: { productoId: true },
    distinct: ["productoId"],
  });
  const vendidosAlgunaVez = new Set(vendidos.map((v) => v.productoId));

  const conProveedor = new Set(
    (await db.proveedorPorProducto.findMany({ select: { productoId: true }, distinct: ["productoId"] })).map((p) => p.productoId)
  );

  const pvSinVentaNunca = Array.from(productos.values())
    .filter((info) => info.tipo === "PV" && info.disponible && !vendidosAlgunaVez.has(info.id))
    .map((info) => ({ productoId: info.id, producto: info.nombre, codigo: info.codigo }))
    .sort((a, b) => a.producto.localeCompare(b.producto));

  const insumosConRecetaSinProveedor = Array.from(productos.values())
    .filter((info) => info.tipo === "MP" && info.disponible && !info.seProduce && mpsEnRecetas.has(info.id) && !conProveedor.has(info.id))
    .map((info) => ({ productoId: info.id, producto: info.nombre, codigo: info.codigo, insumoNombre: info.insumoNombre }))
    .sort((a, b) => a.producto.localeCompare(b.producto));

  return { pvSinVentaNunca, insumosConRecetaSinProveedor };
}

/**
 * Port de detectarInsumosConUnidadMezclada (Catalogo.js:4134-4161) —
 * auditoría de CATÁLOGO pura (no depende de stock ni de sucursal, a
 * diferencia de FilaStockPorFamilia.unidadesMezcladas en
 * src/core/stock/por-familia.ts, que es la misma señal pero acotada a lo
 * que tiene movimientos en una sección puntual). Incluye productos
 * inactivos a propósito — mismo criterio que el original
 * (obtenerUnidadPorInsumo_ no filtra por activo).
 */
export async function obtenerProblemasUnidadMezclada(db: Db): Promise<ProblemaUnidadMezclada[]> {
  const productos = await db.producto.findMany({
    where: { insumoId: { not: null } },
    include: { insumo: true, unidadStock: true },
  });

  const porInsumo = new Map<string, { insumoNombre: string; productos: { nombre: string; unidad: string }[] }>();
  for (const p of productos) {
    if (!p.insumo) continue;
    if (!porInsumo.has(p.insumo.id)) porInsumo.set(p.insumo.id, { insumoNombre: p.insumo.nombre, productos: [] });
    porInsumo.get(p.insumo.id)!.productos.push({ nombre: p.nombre, unidad: p.unidadStock.nombre });
  }

  const problemas: ProblemaUnidadMezclada[] = [];
  for (const [insumoId, g] of porInsumo) {
    const unidades = Array.from(new Set(g.productos.map((p) => p.unidad)));
    if (unidades.length > 1) problemas.push({ insumoId, insumo: g.insumoNombre, unidades, productos: g.productos });
  }
  return problemas.sort((a, b) => a.insumo.localeCompare(b.insumo));
}