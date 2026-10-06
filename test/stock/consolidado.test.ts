import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { calcularStockConsolidado } from "../../src/core/stock/consolidado";
import { prisma } from "../setup/test-db";

describe("calcularStockConsolidado", () => {
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

  it("un producto elegible sin ningún movimiento aparece igual, en SIN_MOVIMIENTOS", async () => {
    await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    const fila = filas.find((f) => f.productoNombre === "Sal");
    expect(fila?.estado).toBe("SIN_MOVIMIENTOS");
    expect(fila?.seccionId).toBeNull();
    expect(fila?.teorico).toBe(0);
  });

  it("con movimientos pero sin conteo físico todavía: SIN_CONTEO", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === mp.id);
    expect(fila?.estado).toBe("SIN_CONTEO");
    expect(fila?.teorico).toBe(10);
  });

  it("conteo sin diferencia: CONCILIADO; con diferencia: CON_DESVIO", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_3", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 10, fechaConteo: new Date(), accion: "AJUSTAR" });

    let filas = await calcularStockConsolidado(sucursalId, prisma);
    expect(filas.find((f) => f.productoId === mp.id)?.estado).toBe("CONCILIADO");

    // Ahora se desvía: entra una compra nueva sin que se vuelva a contar.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 3 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 20, fechaConteo: new Date(), accion: "FALTA_MOVIMIENTO" });

    filas = await calcularStockConsolidado(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === mp.id);
    expect(fila?.estado).toBe("CON_DESVIO");
    expect(fila?.diferencia).toBe(7); // 20 contados - 13 teórico al momento del conteo
  });

  it("un PV \"Se produce\" vendido de más que lo producido queda NEGATIVO (Venta nunca valida el stock del propio PV, solo el de su receta)", async () => {
    const { registrarVenta } = await import("../../src/server/actions/movimientos/venta");
    const pv = await sembrarProductoDisponible({ codigo: "PV_3", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, seProduce: true, precioVenta: 10 }, sucursalId);
    await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date(), seccionId, items: [{ productoId: pv.id, cantidad: 2 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 5 }] });

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === pv.id);
    expect(fila?.teorico).toBe(-3);
    expect(fila?.estado).toBe("NEGATIVO");
  });

  it("un conteo DESCARTADO no cuenta como último conteo válido", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_5", nombre: "Yerba", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 99, fechaConteo: new Date(), accion: "DESCARTAR" });

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    const fila = filas.find((f) => f.productoId === mp.id);
    expect(fila?.estado).toBe("SIN_CONTEO"); // el descartado no cuenta
    expect(fila?.ultimoFisico).toBeNull();
  });

  it("un PV normal (no \"Se produce\") no aparece en el consolidado", async () => {
    await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Gaseosa", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    expect(filas.find((f) => f.productoNombre === "Gaseosa")).toBeUndefined();
  });

  it("un PV \"Se produce\" SÍ aparece", async () => {
    await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Empanada", tipo: "PV", unidadStockId: unidadKgId, seProduce: true }, sucursalId);

    const filas = await calcularStockConsolidado(sucursalId, prisma);
    expect(filas.find((f) => f.productoNombre === "Empanada")).toBeDefined();
  });

  it("no cruza sucursales: un movimiento y un conteo hechos en otra sucursal no aparecen en el consolidado de esta", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_X", nombre: "Cruce", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 4 }] });

    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = await sembrarSeccion(norte.id, "Depósito Norte");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte.id, productoId: mp.id, disponible: true } });
    const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const adminNorte = await crearUsuarioConMembresia({ email: "norte@test.com", sucursalId: norte.id, rolId: rolAdmin.id });
    await mockearUsuarioActual({ id: adminNorte.id, email: adminNorte.email, nombre: null });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionNorte.id, items: [{ productoId: mp.id, cantidad: 100 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId: seccionNorte.id, conteoReal: 100, fechaConteo: new Date(), accion: "AJUSTAR" });

    const central = (await calcularStockConsolidado(sucursalId, prisma)).filter((f) => f.productoId === mp.id);
    expect(central).toHaveLength(1);
    expect(central[0].seccionId).toBe(seccionId);
    expect(central[0].teorico).toBe(4);
    expect(central[0].estado).toBe("SIN_CONTEO");

    const enNorte = (await calcularStockConsolidado(norte.id, prisma)).filter((f) => f.productoId === mp.id);
    expect(enNorte).toHaveLength(1);
    expect(enNorte[0].seccionId).toBe(seccionNorte.id);
    expect(enNorte[0].teorico).toBe(100);
    expect(enNorte[0].estado).toBe("CONCILIADO");
  });
});
