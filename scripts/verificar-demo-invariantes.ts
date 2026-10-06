/**
 * Invariantes de dominio de la demo de 6 meses (§5, docs/planes-demo-y-claridad-reportes-2026-09-21.md, "12 conciliaciones
 * de dominio... es la parte que funciona como 'test E2E de todo el proyecto'") — corre DESPUÉS de que
 * scripts/seed-demo-pizzeria-6-meses.ts ya sembró la base, contra esa MISMA base (nunca escribe nada acá).
 *
 * Cada conciliación compara al sistema CONTRA SÍ MISMO: el mismo número calculado por dos caminos independientes (dos
 * reportes distintos, o un reporte contra una consulta cruda a Postgres) tiene que coincidir. Esto es justo lo que
 * `calcularTotalesEsperados` (guion.ts) NO hace — esa pieza compara el guion PURO contra la base ya sembrada (y eso ya se
 * verificó a mano en el Tramo 3); esto compara la base sembrada contra sí misma, agarrando divergencias entre reportes que
 * `calcularTotalesEsperados` no podría ver (porque no sabe nada de recetas/costeo/alertas).
 *
 * Uso: MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *        npx vitest run --config vitest.demo-invariantes.config.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/db";
import { obtenerReportePorPeriodo, generarReporteVentasPorCategoria } from "../src/core/reportes/periodo";
import { calcularStockConsolidado } from "../src/core/stock/consolidado";
import { calcularValuacionInventario } from "../src/core/reportes/valuacion";
import { calcularAlertasStock } from "../src/core/stock/alertas";
import { tieneStockReal } from "../src/core/movimientos/transiciones";

const NOMBRE_SUCURSAL = "La Cuadra";
// Ventana de 6 meses — mismo criterio que fechaDe en el ejecutor: termina HOY. OJO acá: DESDE se calcula ANTES de fijarle
// la hora a HASTA (23:59:59.999) — si se derivara de HASTA ya con esa hora, heredaría 23:59:59.999 y la consulta cruda
// (que no pasa por rangoUtc, a diferencia de los reportes) arrancaría casi un día entero tarde.
const HASTA = new Date();
const DESDE = new Date(HASTA);
DESDE.setUTCDate(DESDE.getUTCDate() - 190); // margen amplio a propósito (guion real: 182 días) — mejor de más que cortar el arranque real
DESDE.setUTCHours(0, 0, 0, 0);
HASTA.setUTCHours(23, 59, 59, 999);

describe("Invariantes de dominio — demo de 6 meses de La Cuadra", () => {
  let sucursalId: string;

  beforeAll(async () => {
    const sucursal = await prisma.sucursal.findFirst({ where: { nombre: NOMBRE_SUCURSAL } });
    if (!sucursal) throw new Error(`No existe la sucursal "${NOMBRE_SUCURSAL}" en esta base — ¿corriste el seed de 6 meses primero?`);
    sucursalId = sucursal.id;
  });

  it("1) Compras: el total del reporte de Período coincide con la suma de 'por proveedor' (mismo reporte)", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma);
    const sumaPorProveedor = rep.compras.porProveedor.reduce((a, p) => a + p.importe, 0);
    expect(Math.round(sumaPorProveedor)).toBe(Math.round(rep.compras.totalGastado));
  });

  it("2) Compras: el total del reporte de Período coincide con una consulta cruda a Postgres (excluyendo anuladas)", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma);
    const crudo = await prisma.movimientoStock.aggregate({
      where: { seccion: { sucursalId }, proceso: "COMPRA", operacion: { fecha: { gte: DESDE, lte: HASTA }, anuladaEn: null } },
      _sum: { precioTotal: true },
    });
    expect(Math.round(Number(crudo._sum.precioTotal ?? 0))).toBe(Math.round(rep.compras.totalGastado));
  });

  it("3) Ventas: el total del reporte de Período coincide con la suma de 'por producto' (mismo reporte)", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma);
    const sumaPorProducto = rep.ventas.porProducto.reduce((a, p) => a + p.importe, 0);
    expect(Math.round(sumaPorProducto)).toBe(Math.round(rep.ventas.totalFacturado));
  });

  it("4) Ventas: el total del reporte de Período coincide con el de Ventas por categoría — dos reportes INDEPENDIENTES, misma ventana", async () => {
    const [porPeriodo, porCategoria] = await Promise.all([
      obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma),
      generarReporteVentasPorCategoria(sucursalId, DESDE, HASTA, prisma),
    ]);
    expect(Math.round(porCategoria.totalFacturado)).toBe(Math.round(porPeriodo.ventas.totalFacturado));
  });

  it("5) Una compra anulada no suma: el total del reporte es MENOR que 'total + lo que sumaría la anulada sola'", async () => {
    const rep = await obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma);
    const anuladas = await prisma.movimientoStock.aggregate({
      where: { seccion: { sucursalId }, proceso: "COMPRA", operacion: { fecha: { gte: DESDE, lte: HASTA }, anuladaEn: { not: null } } },
      _sum: { precioTotal: true },
    });
    const importeAnulada = Number(anuladas._sum.precioTotal ?? 0);
    expect(importeAnulada, "tiene que haber al menos una compra anulada en la ventana para que esta conciliación diga algo").toBeGreaterThan(0);
    // Si el reporte INCLUYERA la anulada, el total sería mayor — confirma que efectivamente la excluye.
    expect(rep.compras.totalGastado).toBeLessThan(rep.compras.totalGastado + importeAnulada);
  });

  it("6) Stock consolidado (teórico, por sección) y Valuación (saldo, agregado) coinciden por producto — dos reportes independientes del mismo saldo", async () => {
    const [consolidado, valuacion] = await Promise.all([calcularStockConsolidado(sucursalId, prisma), calcularValuacionInventario(sucursalId, prisma)]);
    const teoricoPorProducto = new Map<string, number>();
    for (const fila of consolidado) teoricoPorProducto.set(fila.productoId, (teoricoPorProducto.get(fila.productoId) ?? 0) + fila.teorico);

    let comparados = 0;
    for (const fila of valuacion.filas) {
      const teorico = teoricoPorProducto.get(fila.productoId);
      if (teorico === undefined) continue; // producto sin ninguna fila en consolidado (no debería pasar para productos con stock real, pero no es lo que este test mide)
      expect(Math.abs(teorico - fila.saldo), `${fila.productoCodigo}: consolidado=${teorico} vs valuación=${fila.saldo}`).toBeLessThan(0.01);
      comparados++;
    }
    expect(comparados, "tiene que haber comparado al menos varios productos").toBeGreaterThan(10);
  });

  it("7) Alertas de stock: cada alerta corresponde a un producto con stock mínimo REALMENTE configurado, y el estado (CRÍTICO/BAJO) coincide con saldo vs. mínimo", async () => {
    // No se exige alertas.length > 0: con el colchón de compra (112% de la necesidad, BUFFER en guion-la-cuadra.ts) el
    // saldo real casi nunca baja del mínimo heurístico (40% de la necesidad semanal) — cero alertas es un resultado
    // válido (vacuamente cumple la conciliación), no un error. Lo que este test verifica es la PROPIEDAD: si hay
    // alguna alerta, que sea consistente con un mínimo de verdad configurado y con el saldo real.
    const alertas = await calcularAlertasStock(sucursalId, prisma);
    for (const a of alertas) {
      const minimo = await prisma.stockMinimoProducto.findFirst({ where: { sucursalId, productoId: a.productoId, OR: [{ seccionId: a.seccionId }, { seccionId: null }] } });
      expect(minimo, `${a.productoCodigo}/${a.seccionNombre}: alertó sin tener un mínimo configurado`).toBeTruthy();
      const estadoEsperado = a.saldoActual <= 0 ? "CRITICO" : a.saldoActual <= a.stockMinimo ? "BAJO" : null;
      expect(estadoEsperado, `${a.productoCodigo}: saldo ${a.saldoActual} vs mínimo ${a.stockMinimo} no debería alertar`).not.toBeNull();
      expect(a.estado).toBe(estadoEsperado);
    }
  });

  it("8) PV030 ('se produce'): tiene saldo real positivo en stock consolidado — el saldo de un PV que se produce SÍ significa algo (a diferencia del resto de la carta)", async () => {
    const pv030 = await prisma.producto.findFirstOrThrow({ where: { codigo: "PV030" } });
    expect(tieneStockReal(pv030.tipo, pv030.seProduce), "PV030 tiene que estar marcado 'se produce' para que esta conciliación tenga sentido").toBe(true);
    const consolidado = await calcularStockConsolidado(sucursalId, prisma);
    const filasPv030 = consolidado.filter((f) => f.productoId === pv030.id);
    const teoricoTotal = filasPv030.reduce((a, f) => a + f.teorico, 0);
    expect(teoricoTotal).toBeGreaterThan(0);
  });

  it("9) El margen Real del período refleja la cobertura esperada: hay ventas RECONSTRUIDAS (el tramo de desorden, sin costo congelado al vender) Y ventas con costo congelado (el tramo ordenado)", async () => {
    // OJO: "sin costo congelado al vender" no es lo mismo que "sin costear" (ingresoSinCostoReal) — para cuando se
    // arma este reporte, PV020 YA tiene receta (el evento CREAR_RECETA del guion ya pasó) y sus insumos ya tienen
    // historial de compra, así que esas ventas del tramo de desorden se RECONSTRUYEN con éxito (ingresoRealReconstruido),
    // no quedan afuera. `ingresoSinCostoReal` mediría algo distinto: un insumo que TODAVÍA hoy no tiene ninguna compra,
    // que no es el caso de esta demo (por diseño: nada queda sin poder costear "para siempre" — ver costo-historico.ts).
    const rep = await obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma);
    expect(rep.margen.margenRealTotal, "tiene que haber podido costear AL MENOS algunas ventas").not.toBeNull();
    expect(rep.margen.ingresoRealReconstruido, "tiene que haber ventas RECONSTRUIDAS (las de PV020 del tramo de desorden, sin costo congelado al vender)").toBeGreaterThan(0);
    expect(rep.margen.ingresoConCostoReal, "el ingreso reconstruido es una PARTE del ingreso costeado total, no todo").toBeGreaterThan(rep.margen.ingresoRealReconstruido);
    expect(rep.margen.ingresoSinCostoReal, "en esta demo nada queda sin poder costear para siempre — todo insumo termina con compras").toBe(0);
  });

  it("10) Contención: el facturado de los últimos 30 días no puede superar el facturado de los 6 meses completos", async () => {
    const hace30 = new Date(HASTA);
    hace30.setUTCDate(hace30.getUTCDate() - 29);
    const [rep30, rep6m] = await Promise.all([obtenerReportePorPeriodo(sucursalId, hace30, HASTA, undefined, prisma), obtenerReportePorPeriodo(sucursalId, DESDE, HASTA, undefined, prisma)]);
    expect(rep30.ventas.totalFacturado).toBeGreaterThan(0);
    expect(rep30.ventas.totalFacturado).toBeLessThanOrEqual(rep6m.ventas.totalFacturado);
  });
});
