import { redondearMoneda } from "@/core/moneda";
import { redondearCantidad, type Db, type InfoProductoReporte } from "./comun";
import {
  antiguedadSerieIPC,
  cargarSerieIPC,
  esMesSinPublicar,
  resolverVariacionPeriodoIPC,
  textoSerieIPCVencida,
  type AntiguedadSerieIPC,
} from "./indices-economicos";
import type { ItemPeriodo } from "./periodo-tipos";
import type { FilaVentaProducto } from "./periodo-ventas";

export interface FilaPrecioInsumo {
  insumo: string;
  grupo: string | null;
  /** $ por unidad de stock, promedio ponderado por cantidad de las compras del período. */
  precioUnitarioPromedio: number;
  cantidadComprada: number;
  /** Precio unitario de la última Compra de este insumo ANTES de que empezara el período — null si nunca se compró antes (primera vez) o esa compra no tenía precio real. */
  precioUnitarioAnterior: number | null;
  deltaPct: number | null;
  /** (precioUnitarioPromedio - precioUnitarioAnterior) × cantidadComprada — lo que realmente costó (o ahorró) el cambio de precio, a la cantidad que efectivamente se compró. Esto es lo que ordena la lista, no el %. */
  deltaImpacto: number | null;
  /** |deltaPct| pasa un umbral poco creíble para una suba real de precio — más probable un error de carga (unidad/presentación mal tipeada) que una suba genuina. Se muestra igual, marcado, en vez de ocultarlo o de tratarlo como un hecho. */
  sospechoso: boolean;
}

const UMBRAL_VARIACION_SOSPECHOSA_PCT = 200;

/**
 * Precio anterior a `desde` de cada insumo — el más reciente de TODAS sus
 * Compras previas (cualquier producto de ese Insumo), sin importar cuánto
 * tiempo pasó. Una sola consulta ordenada por fecha desc + quedarse con la
 * primera aparición de cada insumo en JS (evita 1 query por insumo).
 */
async function obtenerPrecioAnteriorPorInsumo(
  sucursalId: string,
  desde: Date,
  productos: Map<string, InfoProductoReporte>,
  insumosDelPeriodo: Set<string>,
  db: Db
): Promise<Map<string, number>> {
  const productoIdsRelevantes = Array.from(productos.entries())
    .filter(([, info]) => info.insumoNombre && insumosDelPeriodo.has(info.insumoNombre))
    .map(([id]) => id);
  if (!productoIdsRelevantes.length) return new Map();

  const previas = await db.movimientoStock.findMany({
    where: { productoId: { in: productoIdsRelevantes }, proceso: "COMPRA", seccion: { sucursalId }, operacion: { fecha: { lt: desde }, anuladaEn: null } },
    select: { productoId: true, precioTotal: true, cantidad: true },
    orderBy: { operacion: { fecha: "desc" } },
  });

  const precioAnteriorPorInsumo = new Map<string, number>();
  for (const m of previas) {
    const insumo = productos.get(m.productoId)?.insumoNombre;
    if (!insumo || precioAnteriorPorInsumo.has(insumo)) continue; // ya se guardó la más reciente de ese insumo (viene ordenado desc)
    const cantidad = Number(m.cantidad);
    const precioTotal = Number(m.precioTotal);
    if (cantidad > 0 && precioTotal > 0) precioAnteriorPorInsumo.set(insumo, precioTotal / cantidad);
  }
  return precioAnteriorPorInsumo;
}

/**
 * "¿Estoy pagando más que antes?" — paso 2 del grounding (segunda pasada,
 * docs/grounding-reportes-compras-2026-09-18.md §5): a diferencia de una
 * primera versión que hubiera ordenado por % de variación, esto ordena
 * por IMPACTO EN $ (Δprecio × cantidad comprada) — un insumo barato que
 * sube 60% puede pesar menos que uno caro que sube 7%, y el % solo
 * confunde esa comparación. Excluye "Sin insumo asignado" a propósito:
 * promediar el precio de productos sin relación entre sí no tiene
 * sentido (a diferencia de `calcularGastoPorInsumoDelPeriodo`, que sí
 * necesita un bucket para eso porque ahí solo suma $, no compara precios).
 */
export async function calcularTendenciaPreciosDelPeriodo(
  sucursalId: string,
  desde: Date,
  items: ItemPeriodo[],
  productos: Map<string, InfoProductoReporte>,
  db: Db
): Promise<FilaPrecioInsumo[]> {
  const porInsumo = new Map<string, { grupo: string | null; sumaPrecioTotal: number; sumaCantidad: number }>();

  for (const r of items) {
    if (r.proceso !== "COMPRA" || r.anulada) continue;
    if (!(r.cantidad > 0) || r.precioTotal <= 0) continue; // sin cantidad o sin precio no aporta un precio unitario real
    const info = productos.get(r.productoId);
    const insumo = info?.insumoNombre;
    if (!insumo) continue;

    if (!porInsumo.has(insumo)) porInsumo.set(insumo, { grupo: info.grupoNombre, sumaPrecioTotal: 0, sumaCantidad: 0 });
    const acc = porInsumo.get(insumo)!;
    acc.sumaPrecioTotal += r.precioTotal;
    acc.sumaCantidad += r.cantidad;
  }

  const preciosAnteriores = await obtenerPrecioAnteriorPorInsumo(sucursalId, desde, productos, new Set(porInsumo.keys()), db);

  const filas: FilaPrecioInsumo[] = Array.from(porInsumo.entries()).map(([insumo, v]) => {
    const precioUnitarioPromedio = redondearMoneda(v.sumaPrecioTotal / v.sumaCantidad);
    const precioUnitarioAnterior = preciosAnteriores.get(insumo) ?? null;

    let deltaPct: number | null = null;
    let deltaImpacto: number | null = null;
    let sospechoso = false;
    if (precioUnitarioAnterior !== null && precioUnitarioAnterior > 0) {
      deltaPct = Math.round(((precioUnitarioPromedio - precioUnitarioAnterior) / precioUnitarioAnterior) * 1000) / 10;
      deltaImpacto = redondearMoneda((precioUnitarioPromedio - precioUnitarioAnterior) * v.sumaCantidad);
      sospechoso = Math.abs(deltaPct) > UMBRAL_VARIACION_SOSPECHOSA_PCT;
    }

    return {
      insumo,
      grupo: v.grupo,
      precioUnitarioPromedio,
      cantidadComprada: redondearCantidad(v.sumaCantidad),
      precioUnitarioAnterior: precioUnitarioAnterior !== null ? redondearMoneda(precioUnitarioAnterior) : null,
      deltaPct,
      deltaImpacto,
      sospechoso,
    };
  });

  filas.sort((a, b) => Math.abs(b.deltaImpacto ?? 0) - Math.abs(a.deltaImpacto ?? 0));
  return filas;
}

export interface ComparativaPreciosDelPeriodo {
  /** Variación agregada ponderada por $ comprado de `tendenciaPrecios` (excluye insumos `sospechoso`: distorsionarían el agregado con lo que probablemente es un error de carga). */
  variacionInsumosPct: number | null;
  /** Variación de `Producto.precioVenta` registrada en RegistroAuditoria durante el período, ponderada por lo facturado en el período de esos mismos productos. */
  variacionCartaPropiaPct: number | null;
  cantidadProductosConCambioCarta: number;
  /** IPC GBA Nivel General (INDEC) del mismo período — contexto de inflación general, no del rubro. */
  variacionIPCPct: number | null;
  aviso: string;
  avisoCarta: string;
  avisoIPC: string;
  /** Cuán vieja es la serie del IPC (5c): con `vencida`, el aviso deja de culpar al INDEC por un atraso que es de la sincronización. */
  antiguedadIPC: AntiguedadSerieIPC;
}

/**
 * "¿Tu carta acompaña estos cambios?" — paso 5 del grounding (segunda
 * pasada, docs/grounding-reportes-compras-2026-09-18.md §5): compara la
 * suba de insumos (ya calculada arriba, ponderada por $) contra dos
 * referencias — la PRIMARIA es el propio historial de precios de venta del
 * negocio (índice de carta propio, vía RegistroAuditoria — Pivote 6), la
 * SECUNDARIA/contextual es el IPC general del mismo período. La primaria
 * importa más: compararte contra vos mismo (¿ajustaste la carta al ritmo
 * de tus costos?) es una pregunta más accionable que compararte contra un
 * promedio nacional que no sabe qué vendés.
 */
export async function calcularComparativaPreciosDelPeriodo(
  desde: Date,
  hasta: Date,
  tendenciaPrecios: FilaPrecioInsumo[],
  ventasPorProducto: FilaVentaProducto[],
  db: Db
): Promise<ComparativaPreciosDelPeriodo> {
  let sumaDeltaInsumos = 0;
  let sumaBaseInsumos = 0;
  for (const f of tendenciaPrecios) {
    if (f.precioUnitarioAnterior === null || f.precioUnitarioAnterior <= 0 || f.sospechoso) continue;
    sumaDeltaInsumos += (f.precioUnitarioPromedio - f.precioUnitarioAnterior) * f.cantidadComprada;
    sumaBaseInsumos += f.precioUnitarioAnterior * f.cantidadComprada;
  }
  const variacionInsumosPct = sumaBaseInsumos > 0 ? Math.round((sumaDeltaInsumos / sumaBaseInsumos) * 1000) / 10 : null;

  const cambiosCarta = await db.registroAuditoria.findMany({
    where: { entidad: "Producto", campo: "precioVenta", creadoEn: { gte: desde, lte: hasta } },
    orderBy: { creadoEn: "asc" },
    select: { entidadId: true, valorAnterior: true, valorNuevo: true },
  });
  // Una sola fila por producto: el primer `valorAnterior` y el último
  // `valorNuevo` del período (vienen ordenados asc) — así 2+ cambios del
  // mismo producto en el período no se cuentan por separado, se ve el
  // cambio NETO del período.
  const porProductoCarta = new Map<string, { primero: number | null; ultimo: number }>();
  for (const c of cambiosCarta) {
    const nuevo = c.valorNuevo !== null ? Number(c.valorNuevo) : NaN;
    if (Number.isNaN(nuevo)) continue;
    const anterior = c.valorAnterior !== null ? Number(c.valorAnterior) : NaN;
    const existente = porProductoCarta.get(c.entidadId);
    if (!existente) porProductoCarta.set(c.entidadId, { primero: Number.isNaN(anterior) ? null : anterior, ultimo: nuevo });
    else existente.ultimo = nuevo;
  }

  const importePorProducto = new Map(ventasPorProducto.map((v) => [v.productoId, v.importe]));
  let sumaPonderadaCarta = 0;
  let sumaPesoCarta = 0;
  let cantidadProductosConCambioCarta = 0;
  for (const [productoId, { primero, ultimo }] of porProductoCarta) {
    if (primero === null || primero <= 0) continue;
    cantidadProductosConCambioCarta++;
    const peso = importePorProducto.get(productoId) ?? 0;
    if (peso > 0) {
      sumaPonderadaCarta += ((ultimo - primero) / primero) * 100 * peso;
      sumaPesoCarta += peso;
    }
  }
  const variacionCartaPropiaPct = sumaPesoCarta > 0 ? Math.round((sumaPonderadaCarta / sumaPesoCarta) * 10) / 10 : null;

  const serieIPC = await cargarSerieIPC(db);
  const variacionIPCPct = resolverVariacionPeriodoIPC(desde, hasta, serieIPC);
  const antiguedadIPC = antiguedadSerieIPC(serieIPC);

  return {
    variacionInsumosPct,
    variacionCartaPropiaPct,
    cantidadProductosConCambioCarta,
    variacionIPCPct,
    antiguedadIPC,
    aviso: "Compara cuánto subieron tus insumos (ponderado por lo que realmente compraste) contra cuánto ajustaste tu propia carta y contra la inflación general — para ver si la carta está acompañando el costo, no solo si subió.",
    avisoCarta:
      variacionCartaPropiaPct !== null
        ? "Ponderado por lo facturado en el período de los productos con cambio de precio de venta registrado (RegistroAuditoria)."
        : cantidadProductosConCambioCarta > 0
          ? "Hubo cambios de precio de venta registrados en el período, pero ninguno de esos productos se vendió en este mismo período — no hay base para ponderar."
          : "Todavía no hay cambios de precio de venta registrados en este período (el registro de auditoría arrancó el 2026-09-18) — este comparador mejora con el uso.",
    avisoIPC:
      variacionIPCPct !== null
        ? `IPC GBA Nivel General (INDEC) del mismo período — contexto de inflación general, no del rubro gastronómico específico.${esMesSinPublicar(hasta, serieIPC) || esMesSinPublicar(desde, serieIPC) ? (antiguedadIPC.estado === "vencida" ? ` ${textoSerieIPCVencida(antiguedadIPC)} Se usó ${serieIPC.ultimoMes}, el último cargado.` : ` PROVISORIO: el INDEC todavía no publicó el mes del período; se usó ${serieIPC.ultimoMes}, el último disponible.`) : ""}`
        : esMesSinPublicar(desde, serieIPC)
          ? antiguedadIPC.estado === "vencida"
            ? // No es el rezago del INDEC: la serie está parada. Decir "lo publica a mitad del mes siguiente" desviaría el diagnóstico.
              textoSerieIPCVencida(antiguedadIPC)
            : "El INDEC todavía no publicó el IPC de este período (lo publica a mitad del mes siguiente): la inflación se va a poder medir cuando salga."
          : "Sin IPC sincronizado para alguno de los dos meses del período.",
  };
}
