import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { preciosLocalesVigentes } from "../../src/core/catalogo/public-servidor";
import { resolverPrecioVenta } from "../../src/core/movimientos/precio-venta";
import { resolverMenuCarta } from "../../src/core/carta/menu-consulta";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { construirMapaProductos } from "../../src/core/reportes/comun";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";

/**
 * Precio Local y la capacidad `precio_local` de la sucursal, contra Postgres real: "la empresa lo tiene o no lo tiene, y punto". Sin
 * la capacidad el precio efectivo es el central aunque exista una fila local habilitada (la fila no se borra: al reactivar vuelve a
 * aplicar). Todos los lectores (venta, carta, selector del POS, reportes) pasan por `preciosLocalesVigentes`.
 */
describe("Precio Local y la capacidad precio_local", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionId: string;
  let productoId: string;

  async function fijarCapacidad(habilitado: boolean, sucursal: string | null) {
    const existente = await prisma.capacidadSucursal.findFirst({ where: { accionClave: "precio_local", sucursalId: sucursal } });
    if (existente) await prisma.capacidadSucursal.update({ where: { id: existente.id }, data: { habilitado } });
    else await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: sucursal, habilitado } });
  }

  async function precioEnCartaPublica(): Promise<number | undefined> {
    const carta = await resolverMenuCarta(sucursalId, prisma);
    return carta?.secciones.flatMap((s) => s.items).find((i) => i.nombre === "Pizza")?.precio;
  }

  /** El precio del pedible de la pizza, esté donde esté en la estructura del selector (sección, carpeta o fuera de carta). */
  function precioDe(nodo: unknown): number | undefined {
    if (Array.isArray(nodo)) return nodo.map(precioDe).find((x) => x !== undefined);
    if (nodo && typeof nodo === "object") {
      const o = nodo as Record<string, unknown>;
      if (o.productoId === productoId && typeof o.precio === "number") return o.precio;
      return Object.values(o).map(precioDe).find((x) => x !== undefined);
    }
    return undefined;
  }

  async function precioEnSelectorPos(): Promise<number | undefined> {
    const selector = await cargarSelectorCartaPos(sucursalId, prisma);
    return precioDe(selector);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const pv = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 1000 }, sucursalId);
    productoId = pv.id;
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccionCarta.id } });
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId, precio: 800, habilitado: true } });
  });

  it("sin ninguna fila de capacidad (nadie la configuró) el precio local rige: ausente = habilitado", async () => {
    expect((await preciosLocalesVigentes(sucursalId, prisma)).get(productoId)?.precio).toBe(800);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(800);
    expect(await precioEnCartaPublica()).toBe(800);
  });

  it("con la capacidad apagada en la sucursal, todos los lectores dan el precio central aunque la fila local esté habilitada", async () => {
    await fijarCapacidad(false, sucursalId);

    expect((await preciosLocalesVigentes(sucursalId, prisma)).size).toBe(0);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);
    expect(await precioEnCartaPublica()).toBe(1000);
    expect(await precioEnSelectorPos()).toBe(1000);
    expect((await construirMapaProductos(sucursalId, prisma)).get(productoId)?.precioVenta).toBe(1000);
  });

  it("la fila local NO se borra al apagar la capacidad: al reactivarla vuelve a aplicar", async () => {
    await fijarCapacidad(false, sucursalId);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);
    expect(await prisma.precioLocalProducto.count({ where: { sucursalId, productoId } })).toBe(1);

    await fijarCapacidad(true, sucursalId);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(800);
    expect(await precioEnCartaPublica()).toBe(800);
    expect(await precioEnSelectorPos()).toBe(800);
    expect((await construirMapaProductos(sucursalId, prisma)).get(productoId)?.precioVenta).toBe(800);
  });

  it("la fila default apagada aplica a una sucursal sin fila propia; la fila propia encendida la pisa", async () => {
    await fijarCapacidad(false, null);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);

    await fijarCapacidad(true, sucursalId);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(800);
  });

  it("apagar la capacidad de una sucursal no afecta a otra", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: otraSucursalId, productoId, precio: 900, habilitado: true } });
    await fijarCapacidad(false, sucursalId);

    expect(await resolverPrecioVenta(otraSucursalId, productoId, 1000, prisma)).toBe(900);
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);
  });

  it("con la capacidad encendida, una fila deshabilitada o la falta de fila dan el central", async () => {
    await prisma.precioLocalProducto.update({ where: { sucursalId_productoId: { sucursalId, productoId } }, data: { habilitado: false } });
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);

    await prisma.precioLocalProducto.delete({ where: { sucursalId_productoId: { sucursalId, productoId } } });
    expect(await resolverPrecioVenta(sucursalId, productoId, 1000, prisma)).toBe(1000);
  });

  it("una venta congela el precio central con la capacidad apagada, y el local con la capacidad encendida", async () => {
    await fijarCapacidad(false, sucursalId);
    await registrarVenta({ fecha: new Date("2026-08-12T12:00:00.000Z"), seccionId, ventas: [{ productoId, cantidadVendida: 1 }] });
    await fijarCapacidad(true, sucursalId);
    await registrarVenta({ fecha: new Date("2026-08-13T12:00:00.000Z"), seccionId, ventas: [{ productoId, cantidadVendida: 1 }] });

    const movimientos = await prisma.movimientoStock.findMany({ where: { productoId, proceso: "VENTA" }, include: { operacion: true } });
    const importePorDia = Object.fromEntries(movimientos.map((m) => [m.operacion.fecha.toISOString().slice(0, 10), Number(m.precioTotal)]));
    expect(importePorDia).toEqual({ "2026-08-12": 1000, "2026-08-13": 800 });
  });
});
