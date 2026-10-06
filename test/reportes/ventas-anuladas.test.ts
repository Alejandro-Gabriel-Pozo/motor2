import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { anularCompra } from "../../src/server/actions/movimientos/compras";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";
import { calcularRendimientoRecetasSimples } from "../../src/server/consultas/reportes/rendimiento-recetas";
import { generarReporteHuecosCatalogo } from "../../src/server/consultas/reportes/huecos-catalogo";
import { generarReporteVentasSinReceta } from "../../src/server/consultas/reportes/ventas-sin-receta";
import { generarReportePerdidas } from "../../src/server/consultas/reportes/perdidas";
import { generarReporteDiferenciasAjustes } from "../../src/server/consultas/reportes/diferencias-ajustes";
import { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION } from "../../src/core/movimientos/anulaciones";

/**
 * Una VENTA anulada es una venta que no ocurrió: ningún reporte de dinero ni de consumo la cuenta. Antes `anularVenta` escribía el contra-asiento (stock bien) pero
 * los reportes seguían sumando el ingreso de la venta anulada (plata mal).
 *
 * Además, la Operación AJUSTE que escribe una anulación (de una venta o de una compra) es el propio deshacer, no un ajuste manual: no puede aparecer en
 * «Diferencias de ajuste».
 *
 * Un kg de harina cuesta $5 (10 kg por $50); un pan lleva 2 kg → cuesta $10 y se vende a $100.
 */
describe("las ventas anuladas no cuentan en los reportes", () => {
  let sucursalId: string;
  let seccionId: string;
  let kgId: string;
  let insumoId: string;
  let adminId: string;
  let harinaId: string;
  let panId: string;

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const agosto = () => obtenerReportePorPeriodo(sucursalId, d("2026-08-01"), d("2026-08-31"), undefined, prisma);

  async function comprarHarina(fecha: string) {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: d(fecha), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }] });
    expect(r.ok, r.mensaje).toBe(true);
  }

  /** Cada `registrarVenta` con un plato crea UNA operación de venta; devuelve su id. */
  async function venderPan(fecha: string, cantidadVendida: number) {
    const antes = new Set((await prisma.operacion.findMany({ where: { proceso: "VENTA" }, select: { id: true } })).map((o) => o.id));
    const r = await registrarVenta({ fecha: d(fecha), seccionId, ventas: [{ productoId: panId, cantidadVendida }] });
    expect(r.ok, r.mensaje).toBe(true);
    const nueva = (await prisma.operacion.findMany({ where: { proceso: "VENTA" }, select: { id: true } })).find((o) => !antes.has(o.id));
    return nueva!.id;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prisma.insumo.deleteMany();
    await prisma.grupo.deleteMany();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });

    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId }, sucursalId)).id;
    panId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, sucursalId)).id;
    await prisma.recetaVersion.create({ data: { productoId: panId, version: 1, ingredientes: { create: [{ insumoProductoId: harinaId, cantidad: 2, unidadId: kgId }] } } });
  });

  describe("Período: ingreso, margen y ratio", () => {
    it("el total vendido, lo vendido por producto y el costo de lo vendido dejan de contar la venta anulada (con la acción real)", async () => {
      await comprarHarina("2026-08-05");
      const ventaA = await venderPan("2026-08-06", 2); // $200, costo $20
      await venderPan("2026-08-07", 1); // $100, costo $10
      expect((await agosto()).ventas.totalFacturado).toBe(300);

      expect((await anularVenta(ventaA)).ok).toBe(true);
      const { ventas, margen } = await agosto();

      expect(ventas.totalFacturado).toBe(100); // solo la vigente; antes de este arreglo seguía en 300
      expect(ventas.porProducto.find((p) => p.productoId === panId)?.cantidad).toBe(1);
      expect(margen.ingresoTotal).toBe(100);
      expect(margen.ingresoConCostoReal).toBe(100);
      expect(margen.costoDeLoVendidoTotal).toBe(10);
      expect(margen.margenRealTotal).toBe(90);
      expect(margen.margenTotal).toBe(90); // costo de hoy (10) sobre lo vendido (100)
    });

    it("anular TODAS las ventas del período deja el reporte en cero, no en una venta fantasma", async () => {
      await comprarHarina("2026-08-05");
      const venta = await venderPan("2026-08-06", 3);
      await anularVenta(venta);

      const { ventas, margen } = await agosto();

      expect(ventas.totalFacturado).toBe(0);
      expect(ventas.porProducto).toEqual([]);
      expect(margen.costoDeLoVendidoTotal).toBeNull();
      expect(margen.margenRealTotal).toBeNull();
      expect(margen.coberturaCostoRealPct).toBeNull();
    });

    it("una venta anulada que se cargó SIN precio tampoco cuenta como «sin precio excluida» ni se estima al precio vigente", async () => {
      await comprarHarina("2026-08-05");
      const op = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: d("2026-08-06"), usuarioId: adminId, anuladaEn: new Date(), anuladaPorId: adminId } });
      await prisma.movimientoStock.create({
        data: { operacionId: op.id, productoId: panId, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 0, precioPorUnidadStock: 0, costoUnitarioVenta: 10 },
      });

      const { ventas, margen } = await agosto();

      expect(ventas.totalFacturado).toBe(0); // sin el filtro se estimaría al precio de venta vigente: $100
      expect(margen.ventasSinPrecioExcluidas).toBe(0);
    });

    it("el ratio Compras/Ventas del período ANTERIOR tampoco cuenta la venta anulada (y compara lo mismo que el actual)", async () => {
      // Julio: compras vigentes por $25 y dos ventas: una de $200 vigente y una de $300 anulada. Con la anulada, el ratio sería 25/500 = 5 %, no 12,5 %.
      await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-07-10"), seccionId, items: [{ productoId: harinaId, cantidad: 5, precioTotal: 25 }] });
      const venta = async (importe: number, anulada: boolean) => {
        const op = await prisma.operacion.create({
          data: { sucursalId, proceso: "VENTA", fecha: d("2026-07-15"), usuarioId: adminId, ...(anulada ? { anuladaEn: new Date(), anuladaPorId: adminId } : {}) },
        });
        await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: panId, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: importe, precioPorUnidadStock: importe } });
      };
      await venta(200, false);
      await venta(300, true);

      expect((await agosto()).ratioGastoVentas.porcentajePeriodoAnterior).toBe(12.5);
    });
  });

  describe("otros reportes", () => {
    it("Rendimiento real de recetas: lo vendido no incluye la venta anulada", async () => {
      await comprarHarina("2026-08-05");
      const anulada = await venderPan("2026-08-06", 4);
      await venderPan("2026-08-07", 1);
      await anularVenta(anulada);

      const filas = await calcularRendimientoRecetasSimples(sucursalId, d("2026-08-01"), d("2026-08-31"), prisma);
      const fila = filas.find((f) => f.productoVentaId === panId);
      expect(fila?.totalVendido).toBe(1); // sin el filtro serían 5
    });

    it("Huecos del catálogo: un plato cuya única venta fue anulada cuenta como «sin venta nunca»", async () => {
      await comprarHarina("2026-08-05");
      const venta = await venderPan("2026-08-06", 1);

      expect((await generarReporteHuecosCatalogo(sucursalId, prisma)).pvSinVentaNunca.map((p) => p.productoId)).not.toContain(panId);
      await anularVenta(venta);
      expect((await generarReporteHuecosCatalogo(sucursalId, prisma)).pvSinVentaNunca.map((p) => p.productoId)).toContain(panId);
    });

    it("Ventas sin receta: una venta anulada de un plato sin receta ya no figura", async () => {
      const sinReceta = await sembrarProductoDisponible({ codigo: "PV_SR", nombre: "Plato sin receta", tipo: "PV", unidadStockId: kgId, precioVenta: 50 }, sucursalId);
      const venta = await registrarVenta({ fecha: d("2026-08-06"), seccionId, ventas: [{ productoId: sinReceta.id, cantidadVendida: 1 }] });
      expect(venta.ok, venta.mensaje).toBe(true);
      expect((await generarReporteVentasSinReceta(sucursalId, prisma)).map((f) => f.productoId)).toContain(sinReceta.id);

      const op = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
      await anularVenta(op.id);
      expect((await generarReporteVentasSinReceta(sucursalId, prisma)).map((f) => f.productoId)).not.toContain(sinReceta.id);
    });

    it("Pérdidas y consumo: el consumo automático por receta de una venta anulada no es consumo", async () => {
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }] });
      const registrada = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: panId, cantidadVendida: 1 }] });
      expect(registrada.ok, registrada.mensaje).toBe(true);
      const antes = await generarReportePerdidas(sucursalId, 30, prisma);
      expect(antes.consumos.length).toBeGreaterThan(0);
      expect(antes.totalConsumo).toBe(10); // 2 kg de harina a $5

      const op = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
      await anularVenta(op.id);
      const despues = await generarReportePerdidas(sucursalId, 30, prisma);
      expect(despues.consumos).toEqual([]);
      expect(despues.totalConsumo).toBe(0);
    });
  });

  describe("Diferencias de ajuste: la reversión por anulación no es un ajuste manual", () => {
    async function ajusteDeHarina() {
      const fila = (await generarReporteDiferenciasAjustes(sucursalId, prisma)).find((f) => f.productoId === harinaId);
      return { suma: fila?.sumaAjustesManuales ?? 0, sugerencia: fila?.sugerenciaMerma ?? null };
    }

    it("anular una VENTA no deja un ajuste de +2 kg de harina (ni la sugerencia falsa de bajar la merma)", async () => {
      await comprarHarina("2026-08-05");
      const venta = await venderPan("2026-08-06", 1);
      await anularVenta(venta);

      expect(await ajusteDeHarina()).toEqual({ suma: 0, sugerencia: null }); // antes: +2 y «disminuir»
    });

    it("anular una COMPRA no deja un ajuste de −10 kg", async () => {
      await comprarHarina("2026-08-05");
      const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
      expect((await anularCompra(compra.id)).ok).toBe(true);

      expect(await ajusteDeHarina()).toEqual({ suma: 0, sugerencia: null });
    });

    it("un ajuste MANUAL sigue contando, con y sin detalle (el filtro no pierde las operaciones sin detalleLibre)", async () => {
      await comprarHarina("2026-08-05");
      const sinDetalle = await registrarMovimiento({ proceso: "AJUSTE", fecha: d("2026-08-06"), seccionId, items: [{ productoId: harinaId, cantidad: -1 }] });
      expect(sinDetalle.ok, sinDetalle.mensaje).toBe(true);
      const conDetalle = await registrarMovimiento({ proceso: "AJUSTE", fecha: d("2026-08-07"), seccionId, detalleLibre: "Se derramó un poco", items: [{ productoId: harinaId, cantidad: -0.5 }] });
      expect(conDetalle.ok, conDetalle.mensaje).toBe(true);

      expect((await ajusteDeHarina()).suma).toBe(-1.5);
    });

    it("un ajuste manual cuyo detalle es otro texto que menciona «anulación» sigue contando (solo los prefijos exactos son reversiones)", async () => {
      await comprarHarina("2026-08-05");
      const r = await registrarMovimiento({ proceso: "AJUSTE", fecha: d("2026-08-06"), seccionId, detalleLibre: "Por la anulación de un pedido de la semana pasada", items: [{ productoId: harinaId, cantidad: -2 }] });
      expect(r.ok, r.mensaje).toBe(true);
      expect((await ajusteDeHarina()).suma).toBe(-2);
    });
  });

  it("las acciones escriben la reversión con un detalle que el filtro reconoce (venta y compra): si alguien cambia el texto de una, el filtro lo detecta", async () => {
    await comprarHarina("2026-08-05");
    const venta = await venderPan("2026-08-06", 1);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    await anularVenta(venta);
    // La compra ya no tiene todo su stock (parte se vendió y ya se devolvió con la anulación): con el stock repuesto se puede anular.
    expect((await anularCompra(compra.id)).ok).toBe(true);

    const reversiones = await prisma.operacion.findMany({ where: { proceso: "AJUSTE" } });
    expect(reversiones).toHaveLength(2);
    const noReversiones = await prisma.operacion.findMany({ where: { AND: [{ proceso: "AJUSTE" }, OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION] } });
    expect(noReversiones, "ninguna de las dos reversiones pasa el filtro «no es reversión»").toEqual([]);
    // Y una operación cualquiera (sin detalle) sí lo pasa.
    expect(await prisma.operacion.count({ where: { AND: [{ proceso: "COMPRA" }, OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION] } })).toBe(1);
  });
});
