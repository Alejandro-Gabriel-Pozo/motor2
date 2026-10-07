import { redondearMoneda } from "@/core/moneda";
import type { Db } from "@/lib/db-tipos";
import { calcularMargenNominalDelPeriodo, type CostoMP, type IndiceRecetas, type InfoProductoReporte, type ItemPeriodo, type SerieIPC, type VentasDelPeriodo } from "@/core/reportes/public";
import { antiguedadSerieIPC, esMesSinPublicar, resolverCoeficienteIPC, textoSerieIPCVencida } from "@/core/reportes/public";
import { construirIndiceRecetas } from "@/server/lecturas/reportes/comun";
import { calcularCostosYMargenes } from "@/server/lecturas/reportes/costos";
import { cargarSerieIPC } from "@/server/lecturas/reportes/serie-ipc";
import { calcularMargenRealDelPeriodo } from "@/server/consultas/reportes/margen-real";
import type { FilaMargenProducto, MargenDelPeriodo } from "@/core/reportes/public";

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
  indiceRecetasCargado?: IndiceRecetas,
  /**
   * Lo demás que quien llama ya leyó (O.39 de docs/pureza-integracion.md), para no volver a leerlo: la serie del IPC (`cargarSerieIPC`, la misma para todas
   * las sucursales) y el costo de reposición de HOY de LA MISMA sucursal (`obtenerCostoActualPorMP(sucursalId, db)`). Lo que falte se lee acá.
   */
  cargado: { serieIPC?: SerieIPC; costosActuales?: Map<string, CostoMP> } = {}
): Promise<MargenDelPeriodo> {
  // Sin índice precargado se lee UNA vez y se pasa a las dos mitades (O.39: antes el nominal y el Real lo leían cada uno por su cuenta).
  const indiceRecetas = indiceRecetasCargado ?? (await construirIndiceRecetas(db, sucursalId));
  const costos = await calcularCostosYMargenes(sucursalId, db, productos, indiceRecetas, undefined, cargado.costosActuales);
  const costoPorProducto = new Map(costos.map((c) => [c.productoId, c]));

  // El margen nominal (puro, en core: lo comparte el Consolidado, que solo muestra el total).
  const { porProductoNominal, costoTotal, hayCostoIncompleto, ingresoTotal, margenTotal } = calcularMargenNominalDelPeriodo(ventasDelPeriodo, costos);

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
  const serieIPC = cargado.serieIPC ?? (await cargarSerieIPC(db));
  // 5c: con la serie VENCIDA (parada hace más del máximo previsto) el ajuste sigue calculándose igual —ningún número cambia—, pero deja
  // de decir que es «de hoy»: está en plata del último mes cargado y subestima el margen ajustado. Mismo cálculo, otro aviso.
  const antiguedadIPC = antiguedadSerieIPC(serieIPC, new Date());
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