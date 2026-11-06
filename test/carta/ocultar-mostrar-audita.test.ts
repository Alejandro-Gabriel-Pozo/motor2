import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";

/**
 * Poda del 2026-11-06 (decisión del dueño): para sacar un producto de la carta queda SOLO «Ocultar» (se retira el botón «Quitar de la carta»). Ocultar y mostrar pasan a ser el
 * único camino, así que dejan rastro: quién, cuándo y de qué a qué (`ContenidoCartaProducto.visibleEnCarta`, entidad `${sucursalId}:${productoId}`, mismo molde que
 * «Agregar a la carta» y «Está bien así»). Repetirlo no ensucia el registro; dos a la vez dejan UNA sola fila (el candado del producto ordena las escrituras).
 */
describe("ocultar y mostrar un producto en la carta deja auditoría", () => {
  let sucursalId: string;
  let adminId: string;
  let pizzaId: string;
  let seccionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    adminId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidad = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    pizzaId = (await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidad.id, precioVenta: 1000 }, sucursalId)).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos" } })).id;
    expect((await guardarContenidoCartaProducto(pizzaId, { visibleEnCarta: true, seccionCartaId: seccionId })).ok).toBe(true);
  });

  const auditoria = () => prisma.registroAuditoria.findMany({ where: { entidad: "ContenidoCartaProducto", campo: "visibleEnCarta" }, orderBy: { creadoEn: "asc" } });

  it("ocultar y volver a mostrar dejan una fila cada vez: quién, de qué a qué y en qué sucursal", async () => {
    const antes = (await auditoria()).length;
    expect((await actualizarVisibleEnCarta(pizzaId, false)).ok).toBe(true);
    expect((await actualizarVisibleEnCarta(pizzaId, true)).ok).toBe(true);
    const nuevas = (await auditoria()).slice(antes);
    expect(nuevas).toMatchObject([
      { entidadId: `${sucursalId}:${pizzaId}`, valorAnterior: "true", valorNuevo: "false", actorId: adminId, sucursalId },
      { entidadId: `${sucursalId}:${pizzaId}`, valorAnterior: "false", valorNuevo: "true", actorId: adminId, sucursalId },
    ]);
    expect(nuevas[0].descripcion).toContain("Pizza");
    expect(nuevas[0].creadoEn).toBeInstanceOf(Date);
  });

  it("idempotencia: ocultar dos veces seguidas audita una sola vez (la segunda no cambia nada)", async () => {
    const antes = (await auditoria()).length;
    expect((await actualizarVisibleEnCarta(pizzaId, false)).ok).toBe(true);
    expect((await actualizarVisibleEnCarta(pizzaId, false)).ok).toBe(true);
    expect((await auditoria()).length - antes).toBe(1);
    const fila = await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: pizzaId } });
    expect(fila.visibleEnCarta).toBe(false);
  });

  it("concurrencia: dos «Ocultar» a la vez dejan el producto oculto y UNA sola fila de auditoría", async () => {
    const antes = (await auditoria()).length;
    const resultados = await Promise.all([actualizarVisibleEnCarta(pizzaId, false), actualizarVisibleEnCarta(pizzaId, false)]);
    expect(resultados.map((r) => r.ok)).toEqual([true, true]);
    expect((await auditoria()).length - antes).toBe(1);
    expect((await prisma.contenidoCartaProducto.findFirstOrThrow({ where: { sucursalId, productoId: pizzaId } })).visibleEnCarta).toBe(false);
  });

  it("un rechazo (mostrar sin sección) no escribe ni audita", async () => {
    const sinSeccion = (await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: (await prisma.unidad.findFirstOrThrow()).id, precioVenta: 500 }, sucursalId)).id;
    const antes = (await auditoria()).length;
    expect((await actualizarVisibleEnCarta(sinSeccion, true)).ok).toBe(false);
    expect((await auditoria()).length).toBe(antes);
  });

  it("ocultar un producto que nunca tuvo contenido crea la fila oculta y audita de «sin contenido» a oculto", async () => {
    const nuevo = (await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: (await prisma.unidad.findFirstOrThrow()).id, precioVenta: 700 }, sucursalId)).id;
    expect((await actualizarVisibleEnCarta(nuevo, false)).ok).toBe(true);
    const fila = (await auditoria()).find((f) => f.entidadId === `${sucursalId}:${nuevo}`);
    expect(fila).toMatchObject({ valorAnterior: null, valorNuevo: "false", actorId: adminId, sucursalId });
  });
});
