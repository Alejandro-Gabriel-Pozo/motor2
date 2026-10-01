import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { eliminarSeccionHabitual, listarSeccionesHabituales, setSeccionHabitual } from "../../src/server/actions/stock/seccion-habitual";

/**
 * Pantalla «Sección habitual» (src/server/actions/stock/seccion-habitual.ts, docs/plan-seccion-habitual-stock-2026-09-25.md C2): alta,
 * reemplazo y baja de la sección habitual de un PV en la sucursal activa, con el permiso propio `stock_seccion_habitual`.
 */
describe("Sección habitual (server actions)", () => {
  let sucursalId: string;
  let pizzaId: string;
  let muzzaId: string;
  let cocinaId: string;
  let barraId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    pizzaId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, sucursalId)).id;
    muzzaId = (await sembrarProductoDisponible({ codigo: "MP_MUZZA", nombre: "Muzzarella", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    cocinaId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    barraId = (await sembrarSeccion(sucursalId, "Barra")).id;
  });

  it("alta, reemplazo (una sola fila por producto) y quitar", async () => {
    expect(await setSeccionHabitual(pizzaId, cocinaId)).toEqual({ ok: true, mensaje: "Sección habitual de «Pizza»: «Cocina»." });
    expect(await setSeccionHabitual(pizzaId, barraId)).toEqual({ ok: true, mensaje: "Sección habitual de «Pizza»: «Barra»." });
    const filas = await listarSeccionesHabituales(sucursalId);
    expect(filas.map((f) => [f.producto.nombre, f.seccion.nombre])).toEqual([["Pizza", "Barra"]]);

    expect(await eliminarSeccionHabitual(filas[0].id)).toEqual({ ok: true, mensaje: "«Pizza» ya no tiene sección habitual." });
    expect(await listarSeccionesHabituales(sucursalId)).toEqual([]);
    expect(await prisma.seccionHabitualProducto.count()).toBe(0);
  });

  it("rechaza una MP, sin escribir nada", async () => {
    expect(await setSeccionHabitual(muzzaId, cocinaId)).toEqual({ ok: false, mensaje: "Solo un producto de venta (PV) tiene sección habitual: «Muzzarella» es una materia prima." });
    expect(await prisma.seccionHabitualProducto.count()).toBe(0);
  });

  it("rechaza una sección de otra sucursal y una sección inactiva, sin escribir nada", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const ajena = await sembrarSeccion(norte.id, "Barra Norte");
    expect(await setSeccionHabitual(pizzaId, ajena.id)).toEqual({ ok: false, mensaje: "No se encontró la sección." });
    await prisma.seccion.update({ where: { id: cocinaId }, data: { activa: false } });
    expect(await setSeccionHabitual(pizzaId, cocinaId)).toEqual({ ok: false, mensaje: "La sección «Cocina» está desactivada: activala o elegí otra." });
    expect(await prisma.seccionHabitualProducto.count()).toBe(0);
  });

  it("rechaza el formato vacío (guard) y un producto inexistente", async () => {
    expect(await setSeccionHabitual("", cocinaId)).toEqual({ ok: false, mensaje: "Elegí un producto." });
    expect(await setSeccionHabitual(pizzaId, "")).toEqual({ ok: false, mensaje: "Elegí la sección habitual." });
    expect(await setSeccionHabitual("no-existe", cocinaId)).toEqual({ ok: false, mensaje: "No se encontró el producto." });
  });

  it("el listado no muestra una habitual que apunta a una sección desactivada (ya no manda en el cierre)", async () => {
    await setSeccionHabitual(pizzaId, cocinaId);
    await prisma.seccion.update({ where: { id: cocinaId }, data: { activa: false } });
    expect(await listarSeccionesHabituales(sucursalId)).toEqual([]);
  });

  it("no se puede quitar la fila de otra sucursal", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const barraNorte = await sembrarSeccion(norte.id, "Barra Norte");
    const ajena = await prisma.seccionHabitualProducto.create({ data: { sucursalId: norte.id, productoId: pizzaId, seccionId: barraNorte.id } });
    expect(await eliminarSeccionHabitual(ajena.id)).toEqual({ ok: false, mensaje: "No se encontró esa sección habitual." });
    expect(await prisma.seccionHabitualProducto.count()).toBe(1);
  });

  it("sin permiso de stock_seccion_habitual: no escribe, no quita y no lista", async () => {
    await setSeccionHabitual(pizzaId, cocinaId);
    const fila = await prisma.seccionHabitualProducto.findFirstOrThrow();
    const rol = await prisma.rol.create({ data: { nombre: "sin-stock" } });
    const usuario = await crearUsuarioConMembresia({ email: "sin@test.com", sucursalId, rolId: rol.id });
    await mockearUsuarioActual({ id: usuario.id, email: usuario.email, nombre: null });

    const r = await setSeccionHabitual(pizzaId, barraId);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain('"stock_seccion_habitual"');
    expect((await eliminarSeccionHabitual(fila.id)).ok).toBe(false);
    await expect(listarSeccionesHabituales(sucursalId)).rejects.toThrow();
    expect(await prisma.seccionHabitualProducto.findFirstOrThrow()).toMatchObject({ seccionId: cocinaId });
  });
});
