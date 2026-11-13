import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { listarProductosPagina } from "../../src/server/actions/catalogo/productos";

/**
 * `disponibleAca`/`sucursalesDisponibles`/`totalSucursales` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §10/P10)
 * — batch sin N+1 sobre la página entera, ver listarProductosPagina.
 */
describe("listarProductosPagina", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let unidadKgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("disponibleAca refleja la sucursal ACTIVA de quien mira la lista, no el activo global", async () => {
    const universal = await sembrarProductoDisponible({ codigo: "PV_UNI", nombre: "Universal", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);
    const soloEnOtra = await prisma.producto.create({ data: { codigo: "PV_OTRA", nombre: "Solo en otra", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: soloEnOtra.id, disponible: true } });

    const pagina = await listarProductosPagina();
    expect(pagina.items.find((p) => p.id === universal.id)?.disponibleAca).toBe(true);
    expect(pagina.items.find((p) => p.id === soloEnOtra.id)?.disponibleAca).toBe(false);
  });

  it("sucursalesDisponibles/totalSucursales cuentan sobre TODAS las sucursales activas, no solo la propia", async () => {
    const universal = await sembrarProductoDisponible({ codigo: "PV_UNI2", nombre: "Universal 2", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: otraSucursalId, productoId: universal.id, disponible: true } });
    const soloUna = await sembrarProductoDisponible({ codigo: "PV_SOLA", nombre: "Solo acá", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 10 }, sucursalId);

    const pagina = await listarProductosPagina();
    const filaUniversal = pagina.items.find((p) => p.id === universal.id)!;
    const filaSoloUna = pagina.items.find((p) => p.id === soloUna.id)!;
    expect(filaUniversal.totalSucursales).toBe(2);
    expect(filaUniversal.sucursalesDisponibles).toBe(2);
    expect(filaSoloUna.sucursalesDisponibles).toBe(1);
  });

  it("precio: el central, «Según medida» para el producto por opción, «Sin precio» con 0 y nada para la materia prima; la clase sale de tipo, se produce y respaldo", async () => {
    const directo = await sembrarProductoDisponible({ codigo: "PV_PRE1", nombre: "Con precio", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 9500 }, sucursalId);
    const sin = await sembrarProductoDisponible({ codigo: "PV_PRE2", nombre: "Sin precio", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 0 }, sucursalId);
    const porOpcion = await sembrarProductoDisponible({ codigo: "PV_PRE3", nombre: "Por opcion", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 4000 }, sucursalId);
    await prisma.$executeRaw`UPDATE "Producto" SET "modoDeVenta" = 'BASE_CONFIGURABLE' WHERE id = ${porOpcion.id}`;
    const harina = await sembrarProductoDisponible({ codigo: "MP_PRE4", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, precioVenta: 0 }, sucursalId);
    const salsa = await prisma.producto.create({ data: { codigo: "MP_PRE5", nombre: "Salsa", tipo: "MP", unidadStockId: unidadKgId, seProduce: true } });

    const items = (await listarProductosPagina()).items;
    const de = (id: string) => items.find((p) => p.id === id)!;
    expect(de(directo.id)).toMatchObject({ precio: "$\u00a09.500,00", clase: "venta" });
    expect(de(sin.id).precio).toBe("Sin precio");
    expect(de(porOpcion.id).precio).toBe("Según medida");
    expect(de(harina.id)).toMatchObject({ precio: null, clase: "materia-prima" });
    expect(de(salsa.id)).toMatchObject({ precio: null, clase: "se-produce" });
  });

  it("precio: con la capacidad precio_local prendida rige el de ESTA sucursal; apagada, el central; el de otra sucursal nunca se mezcla", async () => {
    const p = await sembrarProductoDisponible({ codigo: "PV_PRE6", nombre: "Con local", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 1000 }, sucursalId);
    await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: p.id, precio: 1234, habilitado: true } });
    await prisma.precioLocalProducto.create({ data: { sucursalId: otraSucursalId, productoId: p.id, precio: 9999, habilitado: true } });
    const capacidad = await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId, habilitado: true } });
    expect((await listarProductosPagina()).items.find((x) => x.id === p.id)!.precio).toBe("$\u00a01.234,00");
    await prisma.capacidadSucursal.update({ where: { id: capacidad.id }, data: { habilitado: false } });
    expect((await listarProductosPagina()).items.find((x) => x.id === p.id)!.precio).toBe("$\u00a01.000,00");
  });
});
