import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularCostosYMargenes, calcularCostosYMargenesEImpactoInsumos, calcularImpactoRecetasPorPeriodo } from "../../src/server/lecturas/reportes/costos";

describe("calcularCostosYMargenes", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("usa la ÚLTIMA compra registrada (no la más barata) como costo de reposición", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-06-01"), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 150 }] }); // $15/kg, más cara y más reciente

    const filas = await calcularCostosYMargenes(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costo).toBe(2 * 15); // usa el precio de la compra más reciente, no la más barata
  });

  it("marca costoIncompleto sin inventar un margen cuando falta el precio de algún insumo de la receta", async () => {
    const mp1 = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const mp2 = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Levadura", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp1.id, cantidad: 1, unidadId: unidadKgId }, { insumoProductoId: mp2.id, cantidad: 1, unidadId: unidadKgId }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp1.id, cantidad: 10, precioTotal: 100 }] });
    // mp2 nunca se compró: sin costo conocido.

    const filas = await calcularCostosYMargenes(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costoIncompleto).toBe(true);
    expect(fila.costo).toBeNull();
    expect(fila.margen).toBeNull();
    expect(fila.componentes.find((c) => c.insumoProductoId === mp2.id)?.sinPrecio).toBe(true);
  });

  it("margen se calcula sobre la receta CON merma aplicada", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId, mermaPorcentaje: 10 }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg

    const filas = await calcularCostosYMargenes(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costo).toBeCloseTo(1 * 1.1 * 10); // cantidad × (1+merma%) × costo unitario
    expect(fila.margen).toBeCloseTo(100 - 11);
  });

  describe("food cost objetivo (40 % sobre el precio, sin packaging)", () => {
    async function platoConCosto(precioVenta: number | undefined) {
      const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, ...(precioVenta !== undefined && { precioVenta }) }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 4000 }] }); // costo del plato: $4000
      return pv.id;
    }

    it("justo en el 40 % queda OK; con el precio un peso más bajo pasa a «Food cost alto»", async () => {
      const pvId = await platoConCosto(10000);
      let fila = (await calcularCostosYMargenes(sucursalId, prisma)).find((f) => f.productoId === pvId)!;
      expect(fila.foodCostPct).toBe(40);
      expect(fila.estado).toBe("OK");

      await prisma.producto.update({ where: { id: pvId }, data: { precioVenta: 9999 } });
      fila = (await calcularCostosYMargenes(sucursalId, prisma)).find((f) => f.productoId === pvId)!;
      expect(fila.estado).toBe("FOOD_COST_ALTO");
    });

    it("el precio sugerido es el que deja el food cost en el objetivo", async () => {
      const pvId = await platoConCosto(8000);
      const fila = (await calcularCostosYMargenes(sucursalId, prisma)).find((f) => f.productoId === pvId)!;
      expect(fila.estado).toBe("FOOD_COST_ALTO");
      expect(fila.precioSugerido).toBe(10000);
    });

    it("se calcula aunque el producto no tenga precio de venta (para ayudar a ponerlo)", async () => {
      const pvId = await platoConCosto(undefined);
      const fila = (await calcularCostosYMargenes(sucursalId, prisma)).find((f) => f.productoId === pvId)!;
      expect(fila.estado).toBe("SIN_PRECIO_VENTA");
      expect(fila.precioSugerido).toBe(10000);
    });

    it("sin receta o con costo incompleto no hay precio sugerido", async () => {
      const mp1 = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const mp2 = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Levadura", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
      const incompleto = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
      const sinReceta = await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
      await prisma.recetaVersion.create({
        data: { productoId: incompleto.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp1.id, cantidad: 1, unidadId: unidadKgId }, { insumoProductoId: mp2.id, cantidad: 1, unidadId: unidadKgId }] } },
      });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp1.id, cantidad: 10, precioTotal: 100 }] }); // mp2 sin compra

      const filas = await calcularCostosYMargenes(sucursalId, prisma);
      expect(filas.find((f) => f.productoId === incompleto.id)!.precioSugerido).toBeNull();
      expect(filas.find((f) => f.productoId === sinReceta.id)!.precioSugerido).toBeNull();
    });
  });

  it("lee el Kardex LOCAL de la sucursal para el costo, no otra sucursal", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito 2");
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    const usuarioOtra = await crearUsuarioConMembresia({ email: "otra@test.com", sucursalId: otraSucursal.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } })).id });
    await prisma.operacion.create({
      data: {
        sucursalId: otraSucursal.id, proceso: "COMPRA", fecha: new Date(), usuarioId: usuarioOtra.id,
        movimientos: { create: [{ productoId: mp.id, seccionId: otraSeccion.id, proceso: "COMPRA", cantidad: 10, detalle: "Compra otra sucursal.", precioTotal: 1000, precioPorUnidadStock: 100 }] },
      },
    });
    // La sucursal bajo prueba nunca compró esta MP.

    const filas = await calcularCostosYMargenes(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila.costoIncompleto).toBe(true); // no toma el precio $100/kg de la otra sucursal
  });
});

describe("calcularCostosYMargenesEImpactoInsumos: el impacto por insumo", () => {
  it("acumula el costo por insumo a través de varios platos que lo usan", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    const seccion = await sembrarSeccion(base.sucursal.id);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, base.sucursal.id);
    const pv1 = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, base.sucursal.id);
    const pv2 = await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Torta", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 200 }, base.sucursal.id);
    await prisma.recetaVersion.create({ data: { productoId: pv1.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: catalogo.kg.id }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pv2.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: catalogo.kg.id }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccion.id, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg

    const { insumos: impacto } = await calcularCostosYMargenesEImpactoInsumos(base.sucursal.id, prisma);
    const fila = impacto.find((i) => i.insumoProductoId === mp.id)!;
    expect(fila.cantidadPlatos).toBe(2);
    expect(fila.costoAcumulado).toBeCloseTo(1 * 10 + 2 * 10);
  });
});

describe("calcularImpactoRecetasPorPeriodo", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("detecta el plato afectado por un ingrediente DIRECTO que subió de precio, con el food cost % de antes y de ahora", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 10 }] }); // $10/kg, antes del período
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 20 }] }); // $20/kg, dentro del período

    const filas = await calcularImpactoRecetasPorPeriodo(sucursalId, new Date("2026-08-10"), prisma);

    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila).toBeDefined();
    expect(fila.costoAntes).toBe(10);
    expect(fila.costoActual).toBe(20);
    expect(fila.deltaCosto).toBe(10);
    expect(fila.foodCostPctAntes).toBe(10);
    expect(fila.foodCostPctActual).toBe(20);
  });

  it("propaga el aumento a través de un intermedio 'se produce' (ej. una masa premezclada), sin mapear el plato a mano", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const masa = await sembrarProductoDisponible({ codigo: "MP_MASA", nombre: "Masa premezclada", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 500 }, sucursalId);
    // La masa se fabrica con 2kg de harina; la pizza usa 1kg de masa — el aumento de la harina le pega a la pizza SIN que la receta de la pizza mencione harina en absoluto.
    await prisma.recetaVersion.create({ data: { productoId: masa.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 2, unidadId: unidadKgId }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: masa.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 10 }] }); // $10/kg, antes
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 15 }] }); // $15/kg, dentro del período

    const filas = await calcularImpactoRecetasPorPeriodo(sucursalId, new Date("2026-08-10"), prisma);

    const fila = filas.find((f) => f.productoId === pv.id)!;
    expect(fila).toBeDefined();
    expect(fila.costoAntes).toBe(2 * 10); // 1kg de masa = 2kg de harina
    expect(fila.costoActual).toBe(2 * 15);
    expect(fila.deltaCosto).toBe(10);
  });

  it("no incluye un plato cuyo costo no cambió", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 10 }] }); // mismo precio

    const filas = await calcularImpactoRecetasPorPeriodo(sucursalId, new Date("2026-08-10"), prisma);
    expect(filas.find((f) => f.productoId === pv.id)).toBeUndefined();
  });

  it("no marca como 'cambio' la primera compra de un insumo sin historial previo (no hay con qué comparar)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    // Única compra, DENTRO del período elegido — no hay ninguna compra anterior a `desde`.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mp.id, cantidad: 1, precioTotal: 10 }] });

    const filas = await calcularImpactoRecetasPorPeriodo(sucursalId, new Date("2026-08-10"), prisma);
    expect(filas.find((f) => f.productoId === pv.id)).toBeUndefined();
  });

  it("excluye un plato con costo incompleto (falta el precio de algún insumo)", async () => {
    const mp1 = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const mp2 = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Levadura", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp1.id, cantidad: 1, unidadId: unidadKgId }, { insumoProductoId: mp2.id, cantidad: 1, unidadId: unidadKgId }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-05T12:00:00.000Z"), seccionId, items: [{ productoId: mp1.id, cantidad: 1, precioTotal: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-08-11T12:00:00.000Z"), seccionId, items: [{ productoId: mp1.id, cantidad: 1, precioTotal: 20 }] });
    // mp2 nunca se compró: costo incompleto en las dos corridas.

    const filas = await calcularImpactoRecetasPorPeriodo(sucursalId, new Date("2026-08-10"), prisma);
    expect(filas.find((f) => f.productoId === pv.id)).toBeUndefined();
  });
});
