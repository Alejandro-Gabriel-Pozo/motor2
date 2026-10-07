import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Precisión de montos: empates de medio centavo (plan de precisión de montos, 2026-09-25).
 *
 * La auditoría anterior (docs/auditoria-motor2-pivotes-2026-09-16.md §9, caso 6, y precision-costos-precios-reversiones.test.ts)
 * probó 2,5 × 4,05 = 10,125, que es EXACTO en binario (81/8): justo el caso que `Math.round(n * 100) / 100` resuelve bien, y además
 * calculaba el esperado con esa misma fórmula. Acá el oráculo es independiente — `round(v::numeric, 2)` de Postgres — y los casos
 * son empates x,xx5 que NO son exactos en binario, con datos de este dominio.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { redondearMoneda } from "../../src/core/movimientos/transiciones";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularCostosYMargenes } from "../../src/server/lecturas/reportes/costos";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";
import { generarReporteConsignacion } from "../../src/server/consultas/reportes/consignacion";

/** Generador determinista (LCG) — la muestra es siempre la misma, así una diferencia se puede reproducir. */
function* centavosAlAzar(cuantos: number, semilla: number): Generator<number> {
  let x = semilla;
  for (let i = 0; i < cuantos; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    yield x % 10_000_000; // hasta $99.999,99
  }
}

/** "1234.565": el empate x,xx5 escrito en decimal, sin pasar por ninguna cuenta en float. */
function empateDeMedioCentavo(centavos: number, negativo = false): string {
  return `${negativo ? "-" : ""}${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}5`;
}

/** Diferencias entre redondearMoneda y round(v::numeric, 2) de Postgres, sobre valores escritos en decimal. */
async function diferenciasContraPostgres(valores: string[]): Promise<{ valor: string; motor2: number; postgres: number }[]> {
  const filas = await prisma.$queryRaw<{ v: string; r: string }[]>`SELECT v, round(v::numeric, 2)::text AS r FROM unnest(${valores}::text[]) AS v`;
  expect(filas).toHaveLength(valores.length);
  return filas
    .map((f) => ({ valor: f.v, motor2: redondearMoneda(Number(f.v)), postgres: Number(f.r) }))
    .filter((d) => d.motor2 !== d.postgres);
}

describe("Precisión — empates de medio centavo (oráculo: Postgres NUMERIC)", () => {
  let sucursalId: string;
  let seccionId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("redondearMoneda coincide con round(v::numeric, 2) en 2.000 empates x,xx5 positivos", async () => {
    const valores = [...centavosAlAzar(2000, 20260925)].map((c) => empateDeMedioCentavo(c));
    const diferencias = await diferenciasContraPostgres(valores);
    console.log(`[precision] empates positivos distintos de Postgres: ${diferencias.length} de ${valores.length}`, diferencias.slice(0, 3));
    expect(diferencias).toEqual([]);
  });

  it("redondearMoneda coincide con round(v::numeric, 2) en 500 empates x,xx5 negativos (se aleja del cero)", async () => {
    const valores = [...centavosAlAzar(500, 4242)].map((c) => empateDeMedioCentavo(c, true));
    const diferencias = await diferenciasContraPostgres(valores);
    console.log(`[precision] empates negativos distintos de Postgres: ${diferencias.length} de ${valores.length}`, diferencias.slice(0, 3));
    expect(diferencias).toEqual([]);
  });

  it("caso A: factura de $1.024,36 por 8 latas (128,045 c/u) — costo al vender, Costos y márgenes y Valuación dan 128,05", async () => {
    const unidad = await prisma.unidad.create({ data: { nombre: "unidad_lata", magnitud: "CANTIDAD", decimales: 0 } });
    const lata = await sembrarProductoDisponible({ codigo: "MP_LATA", nombre: "Lata de cerveza", tipo: "MP", unidadStockId: unidad.id, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_LATA", nombre: "Cerveza en lata", tipo: "PV", unidadStockId: unidad.id, precioVenta: 2500 }, sucursalId);
    // Reventa: receta 1:1 sin merma.
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: lata.id, cantidad: 1, unidadId: unidad.id }] } } });

    const compra = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: lata.id, cantidad: 8, precioTotal: 1024.36 }] });
    expect(compra.ok, compra.mensaje).toBe(true);
    const movCompra = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: lata.id, proceso: "COMPRA" } });
    expect(movCompra.precioPorUnidadStock.toString()).toBe("128.045");

    // expect.soft: si falla uno, se ven igual todos los valores del caso (costo, margen, costo al vender, valuación).
    const costos = await calcularCostosYMargenes(sucursalId, prisma);
    const fila = costos.find((f) => f.productoId === pv.id)!;
    expect.soft(fila.costo).toBe(128.05);
    expect.soft(fila.componentes[0].costoUnitario).toBe(128.05);
    expect.soft(fila.margen).toBe(2371.96); // 2500 − 128,045 = 2371,955

    const venta = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
    expect(venta.ok, venta.mensaje).toBe(true);
    const movVenta = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: pv.id, proceso: "VENTA" } });
    expect.soft(Number(movVenta.costoUnitarioVenta)).toBe(128.05);

    const valuacion = await calcularValuacionInventario(sucursalId, prisma);
    const filaLata = valuacion.filas.find((f) => f.productoId === lata.id)!;
    expect.soft(filaLata.costoUnitario).toBe(128.05);
  });

  describe("caso B: liquidación de consignación — 0,045 kg de un insumo a $509/kg = 22,905 → 22,91 (en float 22.904999999999998)", () => {
    /** Insumo en consignación a $509/kg (kg con 3 decimales: 0,045 no se redondea al consumir) y su recepción sin costo. */
    async function armarInsumoEnConsignacion() {
      const kg3 = await prisma.unidad.create({ data: { nombre: "kg_3_decimales", magnitud: "PESO", decimales: 3 } });
      const consignante = await prisma.proveedor.create({ data: { codigo: "PRV_QUESOS", nombre: "Quesos del Valle" } });
      const queso = await sembrarProductoDisponible(
        {
          codigo: "MP_QUESO", nombre: "Queso azul en consignación", tipo: "MP", unidadStockId: kg3.id, insumoId,
          esConsignacion: true, proveedorConsignacionId: consignante.id, precioConsignacion: 509,
        },
        sucursalId
      );
      const recepcion = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, proveedorId: consignante.id, items: [{ productoId: queso.id, cantidad: 5 }] });
      expect(recepcion.ok, recepcion.mensaje).toBe(true);
      return { kg3, consignante, queso };
    }

    async function liquidacionDe(quesoId: string) {
      const liquidacion = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: quesoId, proceso: "LIQUIDACION_CONSIGNACION" } });
      const reporte = await generarReporteConsignacion(sucursalId, prisma);
      return { precioTotal: Number(liquidacion.precioTotal), liquidado: reporte.debidoPorConsignante.find((d) => d.proveedor === "Quesos del Valle")?.liquidado };
    }

    it("B1 — venta: la línea LIQUIDACION_CONSIGNACION y el liquidado del reporte dan 22,91", async () => {
      const { kg3, queso } = await armarInsumoEnConsignacion();
      const pv = await sembrarProductoDisponible({ codigo: "PV_TABLA", nombre: "Tabla de quesos", tipo: "PV", unidadStockId: kg3.id, precioVenta: 6000 }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: queso.id, cantidad: 0.045, unidadId: kg3.id }] } } });

      const venta = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 1 }] });
      expect(venta.ok, venta.mensaje).toBe(true);

      const { precioTotal, liquidado } = await liquidacionDe(queso.id);
      expect.soft(precioTotal).toBe(22.91);
      expect.soft(liquidado).toBe(22.91);
    });

    it("B2 — producción: la línea LIQUIDACION_CONSIGNACION y el liquidado del reporte dan 22,91", async () => {
      const { kg3, queso } = await armarInsumoEnConsignacion();
      const salsa = await sembrarProductoDisponible({ codigo: "PV_SALSA", nombre: "Salsa de queso azul", tipo: "PV", unidadStockId: kg3.id, precioVenta: 6000, seProduce: true }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: salsa.id, version: 1, ingredientes: { create: [{ insumoProductoId: queso.id, cantidad: 0.045, unidadId: kg3.id }] } } });

      const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId, items: [{ productoId: salsa.id, cantidad: 1 }] });
      expect(produccion.ok, produccion.mensaje).toBe(true);

      const { precioTotal, liquidado } = await liquidacionDe(queso.id);
      expect.soft(precioTotal).toBe(22.91);
      expect.soft(liquidado).toBe(22.91);
    });
  });

  it("caso C: venta de 0,3 kg de un PV a $1.234,55/kg = 370,365 → la línea VENTA guarda 370,37 (en float 370.36499999999995)", async () => {
    const kg3 = await prisma.unidad.create({ data: { nombre: "kg_3_decimales", magnitud: "PESO", decimales: 3 } });
    const jamon = await sembrarProductoDisponible({ codigo: "MP_JAMON", nombre: "Jamón crudo", tipo: "MP", unidadStockId: kg3.id, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_JAMON", nombre: "Jamón crudo por kg", tipo: "PV", unidadStockId: kg3.id, precioVenta: 1234.55 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: jamon.id, cantidad: 1, unidadId: kg3.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: jamon.id, cantidad: 5 }] });

    const venta = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.3 }] });
    expect(venta.ok, venta.mensaje).toBe(true);

    const movVenta = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: pv.id, proceso: "VENTA" } });
    expect(Number(movVenta.precioTotal)).toBe(370.37);
  });
});
