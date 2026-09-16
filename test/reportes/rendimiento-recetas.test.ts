import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { registrarVenta } from "../../src/server/actions/venta";
import { calcularRendimientoRecetasSimples, calcularRendimientoRecetasCompartidas } from "../../src/core/reportes/rendimiento-recetas";

describe("calcularRendimientoRecetasSimples", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-01-31");
  const dentroDelRango = new Date("2026-01-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("caso simple: un solo PV consume un producto puntual — estima compras/ventas y calcula el desvío", async () => {
    const panRallado = await prisma.producto.create({ data: { codigo: "MP_PAN", nombre: "Pan rallado", tipo: "MP", unidadStockId: unidadKgId } });
    const milanesa = await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: panRallado.id, cantidad: 0.4, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: panRallado.id, cantidad: 10 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 20 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas).toHaveLength(1);
    expect(filas[0].productoVentaNombre).toBe("Milanesa");
    expect(filas[0].cantidadActual).toBe(0.4);
    expect(filas[0].cantidadEstimada).toBe(0.5); // 10 comprado / 20 vendido
    expect(filas[0].desviacionPorcentaje).toBe(25); // (0.5 - 0.4) / 0.4 * 100
    expect(filas[0].confianza).toBe("baja"); // un solo movimiento dentro del rango = 1 semana con datos
  });

  it("agrupa por Insumo: compras de TODOS los hermanos activos, no solo la MP anclada en la receta", async () => {
    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne vacuna" } });
    const nalga = await prisma.producto.create({ data: { codigo: "MP_NALGA", nombre: "Nalga", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id } });
    const lomo = await prisma.producto.create({ data: { codigo: "MP_LOMO", nombre: "Lomo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id } });
    const bife = await prisma.producto.create({ data: { codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: unidadKgId } });
    // La receta ancla en nalga — solo nalga tiene una línea de receta.
    await prisma.recetaVersion.create({
      data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.2, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: nalga.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: lomo.id, cantidad: 3 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas).toHaveLength(1);
    expect(filas[0].totalComprado).toBe(8); // 5 (nalga) + 3 (lomo) — el pool entero
    expect(filas[0].cantidadEstimada).toBe(0.8); // 8 / 10
    expect(filas[0].insumoONombre).toBe("Carne vacuna"); // el nombre del Insumo, no el de la MP ancla (nalga)
  });

  it("caso compartido (2+ PVs consumen del mismo insumo/producto) se omite — Fase 2 no implementada todavía", async () => {
    const huevo = await prisma.producto.create({ data: { codigo: "MP_HUEVO", nombre: "Huevo", tipo: "MP", unidadStockId: unidadKgId } });
    const milanesa = await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId } });
    const pastel = await prisma.producto.create({ data: { codigo: "PV_PASTEL", nombre: "Pastel", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: huevo.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: pastel.id, version: 1, ingredientes: { create: [{ insumoProductoId: huevo.id, cantidad: 0.3, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: huevo.id, cantidad: 10 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 5 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas).toEqual([]);
  });

  it("sin movimientos en el período — devuelve la línea con estimado null y confianza 'sin_datos'", async () => {
    const sal = await prisma.producto.create({ data: { codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId } });
    const papas = await prisma.producto.create({ data: { codigo: "PV_PAPAS", nombre: "Papas fritas", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: papas.id, version: 1, ingredientes: { create: [{ insumoProductoId: sal.id, cantidad: 0.05, unidadId: unidadKgId }] } },
    });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadEstimada).toBeNull();
    expect(filas[0].desviacionPorcentaje).toBeNull();
    expect(filas[0].confianza).toBe("sin_datos");
  });

  it("nunca mezcla sucursales — los movimientos de otra sucursal no cuentan", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito B");

    const queso = await prisma.producto.create({ data: { codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: unidadKgId } });
    const pizza = await prisma.producto.create({ data: { codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: queso.id, cantidad: 0.2, unidadId: unidadKgId }] } },
    });

    // Toda la actividad real pasa en la OTRA sucursal.
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId: otraSeccion.id, items: [{ productoId: queso.id, cantidad: 100 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId: otraSeccion.id, ventas: [{ productoId: pizza.id, cantidadVendida: 50 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadEstimada).toBeNull(); // nada de la sucursal B se filtró acá
  });

  it("respeta el rango de fechas — movimientos fuera del rango no cuentan", async () => {
    const azucar = await prisma.producto.create({ data: { codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId } });
    const torta = await prisma.producto.create({ data: { codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: torta.id, version: 1, ingredientes: { create: [{ insumoProductoId: azucar.id, cantidad: 0.3, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-12-01"), seccionId, items: [{ productoId: azucar.id, cantidad: 999 }] });
    await registrarVenta({ fecha: new Date("2025-12-01"), seccionId, ventas: [{ productoId: torta.id, cantidadVendida: 999 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta);
    expect(filas[0].cantidadEstimada).toBeNull();
  });
});

describe("calcularRendimientoRecetasCompartidas", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-03-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Arma un pool nalga/lomo (mismo Insumo) usado por Milanesa (ancla=nalga) y Bife (ancla=lomo). */
  async function armarPoolCompartido() {
    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne vacuna" } });
    const nalga = await prisma.producto.create({ data: { codigo: "MP_NALGA", nombre: "Nalga", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id } });
    const lomo = await prisma.producto.create({ data: { codigo: "MP_LOMO", nombre: "Lomo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id } });
    const milanesa = await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId } });
    const bife = await prisma.producto.create({ data: { codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: lomo.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    return { milanesa, bife };
  }

  it("resuelve un coeficiente por plato cuando hay suficiente historial y variación en la mezcla de ventas", async () => {
    const { milanesa, bife } = await armarPoolCompartido();

    // Datos generados EXACTAMENTE con Milanesa=0.15kg, Bife=0.25kg — sin
    // ruido, para poder afirmar que la regresión los recupera.
    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 10, bife: 4 },
      { fecha: new Date("2026-01-15"), milanesa: 6, bife: 12 },
      { fecha: new Date("2026-01-25"), milanesa: 15, bife: 2 },
      { fecha: new Date("2026-02-04"), milanesa: 3, bife: 9 },
      { fecha: new Date("2026-02-14"), milanesa: 8, bife: 8 },
    ];
    for (const s of semanas) {
      const comprado = 0.15 * s.milanesa + 0.25 * s.bife;
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: (await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } })).id, cantidad: comprado }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.resoluble)).toBe(true);
    expect(filas[0].r2).toBeCloseTo(1, 3);

    const filaMilanesa = filas.find((f) => f.productoVentaNombre === "Milanesa")!;
    const filaBife = filas.find((f) => f.productoVentaNombre === "Bife")!;
    expect(filaMilanesa.cantidadEstimada).toBeCloseTo(0.15, 2);
    expect(filaBife.cantidadEstimada).toBeCloseTo(0.25, 2);
    expect(filaMilanesa.cantidadPlatosEnPool).toBe(2);
  });

  it("no resoluble si hay pocas semanas de historial (menos que platos+1)", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    // Solo 2 semanas para 2 incógnitas — no alcanza.
    for (const fecha of [new Date("2026-01-05"), new Date("2026-01-15")]) {
      await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId: nalga.id, cantidad: 5 }] });
      await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 10 }] });
      await registrarVenta({ fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: 4 }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta);
    expect(filas.every((f) => !f.resoluble)).toBe(true);
    expect(filas.every((f) => f.cantidadEstimada === null)).toBe(true);
    expect(filas[0].motivoNoResoluble).toMatch(/semanas/i);
  });

  it("no resoluble si la mezcla de ventas nunca varía entre semanas (colineal)", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    // Bife siempre es exactamente el doble de Milanesa — proporción fija, sin variación real.
    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 5, bife: 10 },
      { fecha: new Date("2026-01-15"), milanesa: 8, bife: 16 },
      { fecha: new Date("2026-01-25"), milanesa: 3, bife: 6 },
      { fecha: new Date("2026-02-04"), milanesa: 6, bife: 12 },
    ];
    for (const s of semanas) {
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: nalga.id, cantidad: 2 }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta);
    expect(filas.every((f) => !f.resoluble)).toBe(true);
    expect(filas[0].motivoNoResoluble).toMatch(/mezcla de ventas/i);
  });

  it("un pool con un solo plato no aparece acá — es el caso simple, no el compartido", async () => {
    const panRallado = await prisma.producto.create({ data: { codigo: "MP_PAN", nombre: "Pan rallado", tipo: "MP", unidadStockId: unidadKgId } });
    const milanesa = await prisma.producto.create({ data: { codigo: "PV_MILA_SOLO", nombre: "Milanesa sola", tipo: "PV", unidadStockId: unidadKgId } });
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: panRallado.id, cantidad: 0.04, unidadId: unidadKgId }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-10"), seccionId, items: [{ productoId: panRallado.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date("2026-01-10"), seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 20 }] });

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta);
    expect(filas).toEqual([]);
  });
});
