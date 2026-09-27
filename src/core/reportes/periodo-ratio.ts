import { redondearMoneda } from "@/core/moneda";
import { cargarClasificacionNoComestibles, type Db, type InfoProductoReporte } from "./comun";
import type { ClasificacionNoComestibles } from "@/core/catalogo/public";

export interface RatioGastoVentas {
  /** Compras de comida y bebida ÷ Ventas (sin packaging ni limpieza si el grupo «No comestibles» existe). */
  porcentaje: number | null;
  porcentajePeriodoAnterior: number | null;
  /** Existe el grupo «No comestibles»: el ratio ya viene sin esas compras. */
  excluyeNoComestibles: boolean;
  /** Lo que se compró de no comestibles en el período y quedó fuera del ratio. */
  gastoNoComestibles: number;
  aviso: string;
}

/**
 * "Food cost %" del período (Compras / Ventas), comparado contra el mismo
 * cálculo del período INMEDIATO ANTERIOR de igual duración — paso 0 del
 * grounding (docs/grounding-reportes-compras-2026-09-18.md §5, sugerido en
 * la segunda pasada como más barato y más prioritario que el paso 1 ya
 * implementado: los dos totales ya están calculados en esta misma
 * función, solo falta la comparación).
 *
 * Deliberadamente NO es "food cost" real (consumo/ventas) — es
 * DESEMBOLSO/ventas: una compra grande de stockeo sube este número sin
 * que haya más consumo real ese mismo período. El aviso lo dice explícito
 * (mismo criterio de honestidad que `hayComprasSinPrecio`) en vez de
 * nombrarlo "food cost" y dejar que se lea como un dato que no es.
 */
export async function calcularRatioGastoVentas(
  sucursalId: string,
  desde: Date,
  hasta: Date,
  totalGastado: number,
  totalNoComestibles: number,
  totalFacturado: number,
  productos: Map<string, InfoProductoReporte>,
  db: Db,
  /** La clasificación de grupos "No comestibles" ya cargada, para no volver a leerla (ver `obtenerReportePorPeriodoConCatalogo`). */
  clasificacion?: ClasificacionNoComestibles
): Promise<RatioGastoVentas> {
  const duracionMs = hasta.getTime() - desde.getTime();
  const hastaAnterior = new Date(desde.getTime() - 1);
  const desdeAnterior = new Date(hastaAnterior.getTime() - duracionMs);
  const { existeGrupo } = clasificacion ?? (await cargarClasificacionNoComestibles(db));

  // Por producto (no solo por proceso) para poder sacar los no comestibles también del período anterior: los dos porcentajes se
  // comparan entre sí, así que tienen que excluir lo mismo.
  const filas = await db.movimientoStock.groupBy({
    by: ["proceso", "productoId"],
    // Una compra o una venta anuladas no son gasto ni ingreso: el período anterior tiene que comparar lo mismo que el actual.
    where: {
      seccion: { sucursalId },
      operacion: { fecha: { gte: desdeAnterior, lte: hastaAnterior }, anuladaEn: null },
      proceso: { in: ["COMPRA", "VENTA"] },
    },
    _sum: { precioTotal: true },
  });
  let comprasAnterior = 0;
  let ventasAnterior = 0;
  for (const f of filas) {
    const importe = Number(f._sum.precioTotal ?? 0);
    // Las compras y ventas anuladas ya las dejó afuera la consulta de arriba (`anuladaEn: null`).
    if (f.proceso === "VENTA") ventasAnterior += importe;
    else if (!productos.get(f.productoId)?.esNoComestible) comprasAnterior += importe;
  }

  const calcular = (gastado: number, facturado: number) => (facturado > 0 ? Math.round((gastado / facturado) * 1000) / 10 : null);
  const gastoComida = totalGastado - totalNoComestibles;

  return {
    porcentaje: calcular(gastoComida, totalFacturado),
    porcentajePeriodoAnterior: calcular(comprasAnterior, ventasAnterior),
    excluyeNoComestibles: existeGrupo,
    gastoNoComestibles: redondearMoneda(totalNoComestibles),
    aviso:
      "Compras ÷ Ventas del período — mide desembolso, no consumo real: una compra grande para stockear sube este número sin que se haya consumido más. Sirve para ver la tendencia, no como food cost exacto." +
      (existeGrupo
        ? " Solo cuenta comida y bebida: el packaging y la limpieza (grupo «No comestibles») quedan fuera de este porcentaje, y de su comparación con el período anterior."
        : " Todavía cuenta TODO lo que se compra, incluido el packaging y la limpieza: para separarlos, creá el grupo «No comestibles» (con «Packaging» y «Limpieza» adentro) en Catálogo → Insumos / Grupos y asigná esos insumos."),
  };
}
