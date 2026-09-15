import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import { construirIndiceRecetas, construirMapaProductos, type Db } from "./comun";
import { obtenerReportePorPeriodo } from "./periodo";

export interface ComponentePromocion {
  insumo: string;
  cantidadConsumida: number;
  unidad: string;
}

export interface FilaPromocion {
  producto: string;
  cantidad: number;
  importe: number;
  precioUnitarioReal: number;
  valorALaCartaUnitario: number | null;
  descuentoUnitario: number | null;
  descuentoPct: number | null;
  margen: number | null;
  margenPct: number | null;
  incompleto: boolean;
  componentes: ComponentePromocion[];
}

export type ReportePromociones =
  | { habilitado: false }
  | {
      habilitado: true;
      desde: Date;
      hasta: Date;
      totalFacturadoPromociones: number;
      totalFacturadoALaCarta: number;
      totalFacturado: number;
      porcentajePromociones: number;
      promociones: FilaPromocion[];
      aviso: string;
    };

/**
 * Port de obtenerReportePromociones_ (Reportes.js:373-458). Reusa
 * exactamente las mismas ventas reales que obtenerReportePorPeriodo (Precio
 * Total real cargado en cada venta), solo las separa en dos grupos según
 * `PromocionProducto` (catálogo LOCAL — ver el modelo, Sucursal.
 * promocionesHabilitadas es el apagador general de la feature).
 *
 * "Valor a la carta": cantidad de receta × precioVenta INDIVIDUAL de cada
 * insumo (ya resuelto con Precio Local, ver construirMapaProductos). Si
 * algún insumo no se vende suelto, la promoción queda "incompleta" para ese
 * cálculo en vez de inventar un número.
 */
export async function obtenerReportePromociones(sucursalId: string, desde: Date, hasta: Date, db: Db = prisma): Promise<ReportePromociones> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId } });
  if (!sucursal?.promocionesHabilitadas) return { habilitado: false };

  const rep = await obtenerReportePorPeriodo(sucursalId, desde, hasta, {}, db);
  const marcados = await db.promocionProducto.findMany({ where: { sucursalId } });
  const marcadoPorProducto = new Map(marcados.map((m) => [m.productoId, m.activa]));
  const productos = await construirMapaProductos(sucursalId, db);
  const { recetaPorProducto } = await construirIndiceRecetas(db);
  const margenPorProducto = new Map(rep.margen.porProducto.map((m) => [m.productoId, m]));

  const promociones: FilaPromocion[] = [];
  let totalPromo = 0;
  let totalALaCarta = 0;

  for (const v of rep.ventas.porProducto) {
    const marcadaActiva = marcadoPorProducto.get(v.productoId) === true;
    if (!marcadaActiva) {
      totalALaCarta += v.importe;
      continue;
    }
    totalPromo += v.importe;

    const items = recetaPorProducto.get(v.productoId) ?? [];
    let valorALaCartaUnitario = 0;
    let incompleto = items.length === 0;
    for (const it of items) {
      const precioMP = productos.get(it.insumoProductoId)?.precioVenta ?? 0;
      if (!precioMP) {
        incompleto = true;
        continue;
      }
      valorALaCartaUnitario += precioMP * it.cantidad;
    }

    const precioUnitarioReal = v.cantidad > 0 ? v.importe / v.cantidad : 0;
    const m = margenPorProducto.get(v.productoId);

    const componentes: ComponentePromocion[] = items.map((it) => ({
      insumo: it.insumoNombre,
      cantidadConsumida: redondearMoneda(it.cantidad * v.cantidad),
      unidad: it.unidadNombre,
    }));

    promociones.push({
      producto: v.producto,
      cantidad: v.cantidad,
      importe: v.importe,
      precioUnitarioReal: redondearMoneda(precioUnitarioReal),
      valorALaCartaUnitario: incompleto ? null : redondearMoneda(valorALaCartaUnitario),
      descuentoUnitario: incompleto ? null : redondearMoneda(valorALaCartaUnitario - precioUnitarioReal),
      descuentoPct: !incompleto && valorALaCartaUnitario > 0 ? Math.round(((valorALaCartaUnitario - precioUnitarioReal) / valorALaCartaUnitario) * 1000) / 10 : null,
      margen: m ? m.margen : null,
      margenPct: m ? m.margenPct : null,
      incompleto,
      componentes,
    });
  }

  const totalFacturado = totalPromo + totalALaCarta;

  return {
    habilitado: true,
    desde: rep.desde,
    hasta: rep.hasta,
    totalFacturadoPromociones: redondearMoneda(totalPromo),
    totalFacturadoALaCarta: redondearMoneda(totalALaCarta),
    totalFacturado: redondearMoneda(totalFacturado),
    porcentajePromociones: totalFacturado > 0 ? Math.round((totalPromo / totalFacturado) * 1000) / 10 : 0,
    promociones: promociones.sort((a, b) => b.importe - a.importe),
    aviso:
      'Valor a la carta: cantidad de receta × precio de venta individual de cada insumo (si el insumo no se vende suelto, la promoción queda "incompleta" para ese cálculo). Marcá qué productos son Promoción/Combo desde Reportes > Promociones.',
  };
}
