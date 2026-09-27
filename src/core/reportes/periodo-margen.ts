import { redondearMoneda } from "@/core/moneda";
import type { Db, IndiceRecetas, InfoProductoReporte } from "./comun";
import { calcularCostosYMargenes } from "./costos";
import { resolverAccionFaltante, type AccionFaltante } from "./accion-faltante";
import { calcularMargenRealDelPeriodo } from "./margen-real";
import {
  antiguedadSerieIPC,
  cargarSerieIPC,
  esMesSinPublicar,
  resolverCoeficienteIPC,
  textoSerieIPCVencida,
  type AntiguedadSerieIPC,
} from "./indices-economicos";
import type { ItemPeriodo } from "./periodo-tipos";
import type { VentasDelPeriodo } from "./periodo-ventas";

export interface FilaMargenProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  ingreso: number;
  ingresoEstimado: boolean;
  costoUnitario: number | null;
  costo: number | null;
  costoIncompleto: boolean;
  /** docs/comparativa-ux-erpnext-dolibarr.md §7.1 — mismo criterio causa→acción que ya usaba Costos, ahora compartido. `null` si no falta nada. */
  accionFaltante: AccionFaltante | null;
  margen: number | null;
  margenPct: number | null;
  /**
   * Margen "Real" de ESTE producto (mismo criterio línea a línea que
   * `margenRealTotal` del reporte: costo congelado al vender, o
   * reconstruido con el historial de compras) — fuente única para
   * cualquier consumidor (Período, Promociones), en vez de que cada uno
   * recalcule el suyo. `null` si ninguna venta de este producto en el
   * rango se pudo costear.
   */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Parte de `ingreso` de este producto cuyo costo se reconstruyó (no se guardó al vender) — 0 si ninguna o si `margenReal` es `null`. */
  ingresoRealReconstruido: number;
  /** `false` si alguna venta de este producto quedó afuera de `margenReal` por no poderse costear — la cobertura no es total. */
  margenRealCompleto: boolean;
}
export interface MargenDelPeriodo {
  ingresoTotal: number;
  costoTotal: number;
  margenTotal: number;
  margenPctTotal: number | null;
  hayCostoIncompleto: boolean;
  porProducto: FilaMargenProducto[];
  aviso: string;
  /**
   * "Margen real" (docs/comparativa-ux-erpnext-dolibarr.md §9 y su «Segunda pasada») — a diferencia de margenTotal (receta/costo de
   * HOY aplicados a TODO lo vendido en el rango), esto suma, línea por línea, el costo de cada venta al día de la venta:
   * - si la venta guardó su costo (MovimientoStock.costoUnitarioVenta, ventas cargadas desde la aplicación), ese costo congelado manda;
   * - si no lo guardó, se RECONSTRUYE con el historial de compras (costo-historico.ts: receta de hoy × precio de la compra más
   *   reciente de cada insumo hasta ese día). `ingresoRealReconstruido` es cuánto del ingreso se costeó así (aproximación).
   * `ingresoSinCostoReal` es cuánto quedó afuera por no poderse costear (algún insumo sin compras hasta ese día, o el plato sin
   * receta). `null` si NINGUNA venta del rango se pudo costear.
   */
  margenRealTotal: number | null;
  margenRealPctTotal: number | null;
  ingresoConCostoReal: number;
  ingresoSinCostoReal: number;
  /** Parte de `ingresoConCostoReal` cuyo costo se RECONSTRUYÓ con el historial de compras (la venta no lo guardó al venderse). */
  ingresoRealReconstruido: number;
  avisoReal: string;
  /** Ventas cargadas SIN precio (`precioTotal` en 0) que quedaron afuera del margen Real y del costo de lo vendido: no tienen un ingreso con qué compararse. */
  ventasSinPrecioExcluidas: number;
  /**
   * «Costo de lo vendido (consumo)» (6b): lo que costó, en total, lo que efectivamente se vendió en el rango — el costo congelado al vender (o el
   * reconstruido con el historial de compras) de cada línea COSTEABLE, no lo que se compró. Es el numerador del food cost real; su denominador es
   * `ingresoConCostoReal` (lo vendido que se pudo costear), NUNCA `ingresoTotal`: mezclarlos daría un porcentaje artificialmente bajo, porque el
   * numerador solo cubre una parte de las ventas. Se cumple `costoDeLoVendidoTotal ≈ ingresoConCostoReal − margenRealTotal` (cada número se redondea por
   * separado). `null` si NINGUNA venta del rango se pudo costear.
   *
   * A diferencia del ratio Compras/Ventas (desembolso), INCLUYE el packaging y la limpieza que estén en la receta: `costoUnitarioVenta` guarda el costo
   * total del plato. Por eso los dos números no son comparables al centavo, y el aviso lo dice.
   */
  costoDeLoVendidoTotal: number | null;
  /** `costoDeLoVendidoTotal / ingresoConCostoReal`, en %. */
  costoDeLoVendidoPctTotal: number | null;
  /**
   * Qué parte de lo vendido se pudo costear: `ingresoConCostoReal / (ingresoConCostoReal + ingresoSinCostoReal)`. La base NO es `ingresoTotal`: ese incluye las
   * ventas viejas sin precio valorizadas al precio vigente (estimado), que acá ni siquiera entran. `null` si no hay ventas costeables ni sin costear.
   */
  coberturaCostoRealPct: number | null;
  avisoCostoDeLoVendido: string;
  /**
   * "Margen ajustado por IPC" (Método 1, docs/comparativa-ux-erpnext-
   * dolibarr.md §10) — lleva el ingreso de cada venta a poder adquisitivo
   * del último mes con IPC cargado (`indices-economicos.ts`) ANTES de
   * restarle el costo de HOY (el mismo costoPorProducto que usa
   * margenTotal, a propósito: acá los dos lados de la resta quedan en la
   * misma "moneda" — plata de hoy — a diferencia de margenTotal, que
   * mezcla ingreso histórico nominal con costo de hoy). A diferencia de
   * margenRealTotal, SÍ es retroactivo — el INDEC tiene el índice de
   * cualquier mes pasado — pero depende de que ese mes ya esté
   * sincronizado (`sincronizarIPC`) y de que el producto tenga costo
   * completo hoy. `ingresoSinIPC` es cuánto del ingreso del rango quedó
   * afuera (mes sin IPC publicado/sincronizado, o costo incompleto).
   */
  margenIPCTotal: number | null;
  margenIPCPctTotal: number | null;
  ingresoAjustadoIPCTotal: number;
  ingresoConIPC: number;
  ingresoSinIPC: number;
  /** Cuánto del ingreso con IPC es de un mes que el INDEC todavía no publicó (coeficiente provisorio). */
  ingresoProvisorioIPC: number;
  avisoIPC: string;
  /** Cuán vieja es la serie del IPC (5c). Con `vencida` el ajuste está en plata del último mes cargado, no de hoy. */
  antiguedadIPC: AntiguedadSerieIPC;
}

/**
 * Port de calcularMargenDelPeriodo_ (Reportes.js:304-352). LIMITACIÓN a
 * propósito (igual que el original): el costo usa la receta y los precios
 * de insumos de HOY, no los que regían cuando se vendió cada unidad. Ver
 * `margenRealTotal` para la alternativa que no tiene este descalce
 * temporal (a costo de solo cubrir ventas recientes).
 */
export async function calcularMargenDelPeriodo(
  sucursalId: string,
  items: ItemPeriodo[],
  ventasDelPeriodo: VentasDelPeriodo,
  db: Db,
  productos: Map<string, InfoProductoReporte>,
  /** El índice de recetas ya cargado, para no volver a leerlo — lo necesitan tanto el margen nominal como el Real reconstruido (ver `obtenerReportePorPeriodoConCatalogo`). */
  indiceRecetas?: IndiceRecetas
): Promise<MargenDelPeriodo> {
  const costos = await calcularCostosYMargenes(sucursalId, db, productos, indiceRecetas);
  const costoPorProducto = new Map(costos.map((c) => [c.productoId, c]));

  let costoTotal = 0;
  let hayCostoIncompleto = false;

  const porProductoNominal = ventasDelPeriodo.porProducto
    .map((v) => {
      const infoCosto = costoPorProducto.get(v.productoId);
      const costoUnitario = infoCosto && !infoCosto.costoIncompleto ? Number(infoCosto.costo ?? 0) : null;
      const costoLinea = costoUnitario === null ? null : redondearMoneda(costoUnitario * v.cantidad);

      if (costoLinea === null) hayCostoIncompleto = true;
      else costoTotal += costoLinea;

      const margen = costoLinea === null ? null : redondearMoneda(v.importe - costoLinea);

      return {
        productoId: v.productoId,
        producto: v.producto,
        cantidad: v.cantidad,
        ingreso: v.importe,
        ingresoEstimado: v.estimado,
        costoUnitario: costoUnitario === null ? null : redondearMoneda(costoUnitario),
        costo: costoLinea,
        costoIncompleto: costoLinea === null,
        accionFaltante: infoCosto ? resolverAccionFaltante(infoCosto) : null,
        margen,
        margenPct: margen !== null && v.importe > 0 ? Math.round((margen / v.importe) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity));

  const ingresoTotal = ventasDelPeriodo.totalFacturado;
  const margenTotal = redondearMoneda(ingresoTotal - costoTotal);

  // Margen real: línea por línea (no por producto agregado, a diferencia de arriba) porque dos ventas del MISMO producto en fechas
  // distintas pueden tener costoUnitarioVenta distinto si la receta cambió entre medio. Motor compartido, extraído a
  // src/core/reportes/margen-real.ts (docs/plan-clientes-descuento-2026-09-26.md, punto 8) — mismo criterio línea a línea (costo
  // congelado → reconstruido con el historial de compras → sin costear) que ya usaba este archivo, ahora reusable por otros reportes
  // (el de descuentos por cliente lo usa igual, ver src/core/reportes/descuentos-clientes.ts).
  const {
    ingresoConCostoReal,
    costoRealTotal,
    ingresoSinCostoReal,
    ingresoRealReconstruido,
    ventasSinPrecioExcluidas,
    hayCostoReal,
    margenRealTotal,
    coberturaCostoRealPct,
    porProducto: realPorProducto,
  } = await calcularMargenRealDelPeriodo(sucursalId, items, db, productos, indiceRecetas);
  // Mismo cálculo que adentro de calcularMargenRealDelPeriodo (coberturaCostoRealPct = ingresoConCostoReal / baseCobertura): se
  // rehace acá solo para el texto del aviso de abajo, que necesita el número entero, no el porcentaje ya redondeado.
  const baseCobertura = ingresoConCostoReal + ingresoSinCostoReal;
  const avisoVentasSinPrecio =
    ventasSinPrecioExcluidas > 0
      ? ` ${ventasSinPrecioExcluidas} venta(s) cargada(s) sin precio no se cuentan (no tienen un ingreso con qué comparar su costo).`
      : "";

  const porProducto: FilaMargenProducto[] = porProductoNominal.map((f) => {
    const real = realPorProducto.get(f.productoId);
    if (!real || real.ingresoConCostoReal <= 0) {
      return { ...f, margenReal: null, margenRealPct: null, ingresoRealReconstruido: 0, margenRealCompleto: false };
    }
    const margenReal = redondearMoneda(real.ingresoConCostoReal - real.costoRealTotal);
    return {
      ...f,
      margenReal,
      margenRealPct: Math.round((margenReal / real.ingresoConCostoReal) * 1000) / 10,
      ingresoRealReconstruido: redondearMoneda(real.ingresoRealReconstruido),
      // `f.ingreso` es el total facturado de este producto en el rango (todas sus VENTA) — si coincide con lo
      // costeado en Real, cubrió el 100%; si no, alguna línea de este producto quedó sin costear.
      margenRealCompleto: redondearMoneda(real.ingresoConCostoReal) >= f.ingreso,
    };
  });

  // Margen ajustado por IPC: también línea por línea (cada venta puede
  // caer en un mes distinto, con coeficiente distinto) — mismo
  // costoPorProducto (costo de HOY) que usa el margen nominal arriba, a
  // propósito: acá se ajusta el ingreso para que los dos lados de la
  // resta queden en plata de hoy.
  const serieIPC = await cargarSerieIPC(db);
  // 5c: con la serie VENCIDA (parada hace más del máximo previsto) el ajuste sigue calculándose igual —ningún número cambia—, pero deja
  // de decir que es «de hoy»: está en plata del último mes cargado y subestima el margen ajustado. Mismo cálculo, otro aviso.
  const antiguedadIPC = antiguedadSerieIPC(serieIPC);
  const serieVencida = antiguedadIPC.estado === "vencida";
  const textoBaseAvisoIPC = serieVencida
    ? `Ventas llevadas a poder adquisitivo de ${serieIPC.ultimoMes} (el último mes con IPC cargado), NO de hoy, antes de restar el costo de reposición de HOY. ${textoSerieIPCVencida(antiguedadIPC)} El margen ajustado queda subestimado.`
    : `Ventas llevadas a poder adquisitivo de hoy (IPC INDEC) antes de restar el costo de reposición de HOY — los dos lados de la resta quedan en la misma plata, a diferencia de "Margen".`;
  let ingresoAjustadoIPCTotal = 0;
  let costoIPCTotal = 0;
  let ingresoConIPC = 0;
  let ingresoSinIPC = 0;
  let ingresoProvisorioIPC = 0; // ingreso de meses que el INDEC todavía no publicó (coeficiente provisorio, ver resolverCoeficienteIPC)
  for (const it of items) {
    if (it.proceso !== "VENTA" || it.anulada || it.precioTotal <= 0) continue;
    const infoCosto = costoPorProducto.get(it.productoId);
    const costoUnitario = infoCosto && !infoCosto.costoIncompleto ? Number(infoCosto.costo ?? 0) : null;
    const coeficiente = resolverCoeficienteIPC(it.fecha, serieIPC);
    if (costoUnitario === null || coeficiente === null) {
      ingresoSinIPC += it.precioTotal;
      continue;
    }
    ingresoAjustadoIPCTotal += it.precioTotal * coeficiente;
    costoIPCTotal += it.cantidad * costoUnitario;
    ingresoConIPC += it.precioTotal;
    if (esMesSinPublicar(it.fecha, serieIPC)) ingresoProvisorioIPC += it.precioTotal;
  }
  const margenIPCTotal = ingresoConIPC > 0 ? redondearMoneda(ingresoAjustadoIPCTotal - costoIPCTotal) : null;

  return {
    ingresoTotal,
    costoTotal: redondearMoneda(costoTotal),
    margenTotal,
    margenPctTotal: ingresoTotal > 0 ? Math.round((margenTotal / ingresoTotal) * 1000) / 10 : null,
    hayCostoIncompleto,
    porProducto,
    aviso:
      "Costo calculado con la receta y el costo de reposición VIGENTES hoy (mismo criterio que Costos y Márgenes), no con los que regían en el momento de cada venta."
      + (hayCostoIncompleto ? " Algunos productos vendidos no tienen costo completo y quedan afuera del costo/margen total." : ""),
    margenRealTotal,
    margenRealPctTotal: margenRealTotal !== null && ingresoConCostoReal > 0 ? Math.round((margenRealTotal / ingresoConCostoReal) * 1000) / 10 : null,
    ingresoConCostoReal: redondearMoneda(ingresoConCostoReal),
    ingresoSinCostoReal: redondearMoneda(ingresoSinCostoReal),
    ingresoRealReconstruido: redondearMoneda(ingresoRealReconstruido),
    avisoReal: hayCostoReal
      ? `${
          ingresoRealReconstruido > 0
            ? 'Costo de la receta al día de cada venta (sin el descalce temporal de "Margen" arriba).'
            : 'Costo congelado al momento exacto de cada venta (sin el descalce temporal de "Margen" arriba).'
        }${
          ingresoRealReconstruido > 0
            ? ` RECONSTRUIDO: $${redondearMoneda(ingresoRealReconstruido).toLocaleString("es-AR")} de lo vendido no guardó su costo al venderse y se lo calculó con el historial de compras (el precio de la compra más reciente de cada insumo hasta ese día) y la receta de hoy: es una aproximación.`
            : ""
        }${ingresoSinCostoReal > 0 ? ` No se pudo costear $${redondearMoneda(ingresoSinCostoReal).toLocaleString("es-AR")} (algún insumo sin compras hasta ese día, o el plato sin receta).` : ""}${avisoVentasSinPrecio}`
      : `No hay ventas que se puedan costear al día de la venta (ninguna guardó su costo y falta el historial de compras de algún insumo).${avisoVentasSinPrecio}`,
    ventasSinPrecioExcluidas,
    costoDeLoVendidoTotal: hayCostoReal ? redondearMoneda(costoRealTotal) : null,
    costoDeLoVendidoPctTotal: hayCostoReal ? Math.round((costoRealTotal / ingresoConCostoReal) * 1000) / 10 : null,
    coberturaCostoRealPct,
    avisoCostoDeLoVendido: hayCostoReal
      ? "Costo real de lo que se vendió: el costo congelado al momento de cada venta (o reconstruido con el historial de compras cuando la venta no lo guardó), dividido por lo vendido que se pudo costear — no por el total facturado. " +
        "Mide CONSUMO, a diferencia de Compras/Ventas, que mide desembolso. " +
        "Incluye el packaging y la limpieza que estén en la receta, a diferencia del ratio de compras y del «Food cost %» de Costos y márgenes, que los dejan afuera. " +
        `Cubre $${redondearMoneda(ingresoConCostoReal).toLocaleString("es-AR")} de $${redondearMoneda(baseCobertura).toLocaleString("es-AR")} vendidos (${coberturaCostoRealPct} %)${ingresoSinCostoReal > 0 ? "; el resto no se pudo costear (algún insumo sin compras hasta ese día, o el plato sin receta)" : ""}.${avisoVentasSinPrecio}`
      : `Todavía no hay ventas que se puedan costear: ninguna guardó su costo y falta el historial de compras de algún insumo (o el plato no tiene receta).${avisoVentasSinPrecio}`,
    margenIPCTotal,
    margenIPCPctTotal: margenIPCTotal !== null && ingresoAjustadoIPCTotal > 0 ? Math.round((margenIPCTotal / ingresoAjustadoIPCTotal) * 1000) / 10 : null,
    ingresoAjustadoIPCTotal: redondearMoneda(ingresoAjustadoIPCTotal),
    ingresoConIPC: redondearMoneda(ingresoConIPC),
    ingresoSinIPC: redondearMoneda(ingresoSinIPC),
    ingresoProvisorioIPC: redondearMoneda(ingresoProvisorioIPC),
    antiguedadIPC,
    avisoIPC: ingresoConIPC > 0
      ? `${textoBaseAvisoIPC}${ingresoSinIPC > 0 ? ` Cubre $${redondearMoneda(ingresoConIPC).toLocaleString("es-AR")} de $${ingresoTotal.toLocaleString("es-AR")} — el resto es de un producto con costo incompleto o de un mes que falta en la serie del IPC.` : ""}${ingresoProvisorioIPC > 0 ? ` PROVISORIO: $${redondearMoneda(ingresoProvisorioIPC).toLocaleString("es-AR")} son de un mes que el INDEC todavía no publicó; se los trata como hechos en ${serieIPC.ultimoMes} (el último publicado), sin inflación entre medio.${serieVencida ? "" : " Se corrige solo cuando se publique."}` : ""}`
      : "Todavía no hay índice de IPC sincronizado (o ninguna venta del rango cae en un mes ya sincronizado).",
  };
}
