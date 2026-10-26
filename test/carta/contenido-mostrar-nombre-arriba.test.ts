import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";

/**
 * Fase 5 de la ola «precio y carta» (DEC-11): «Mostrar el nombre del producto arriba» (`ContenidoCartaProducto.mostrarNombreArriba`), el interruptor de un producto base con un solo eje. Lo escribe
 * SOLO `guardarContenidoCartaProducto` (permiso `carta_contenido_producto`, en la sucursal ACTIVA) y se audita POR COLUMNA en la misma transacción. Qué fija:
 *  - prenderlo y apagarlo deja UNA fila de auditoría por cambio (del valor anterior —el default `false` si no había fila— al nuevo, con la sucursal), y repetir el mismo valor no deja otra (idempotente);
 *  - un pedido SIN la clave (un formulario que no la muestra) no lo toca ni audita;
 *  - un valor que no es un sí o un no se rechaza sin escribir;
 *  - sin el permiso, no escribe nada; y escribe siempre en la sucursal activa, nunca en otra.
 */
describe("«Mostrar el nombre arriba» del contenido de carta (DEC-11)", () => {
  let sucursalId: string;
  let otraSucursalId: string;
  let seccionCartaId: string;
  let pizzasId: string;
  let adminRolId: string;
  let operadorRolId: string;

  const fila = (sucursal = sucursalId) => prisma.contenidoCartaProducto.findUnique({ where: { sucursalId_productoId: { sucursalId: sucursal, productoId: pizzasId } } });
  const auditoria = () => prisma.registroAuditoria.findMany({ where: { entidad: "ContenidoCartaProducto", campo: "mostrarNombreArriba" }, orderBy: { creadoEn: "asc" } });
  const guardar = (extra: Record<string, unknown>) => guardarContenidoCartaProducto(pizzasId, { visibleEnCarta: true, seccionCartaId, descripcion: "A la piedra", ...extra });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    operadorRolId = base.operador.id;
    otraSucursalId = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: adminRolId });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Pizzas", orden: 1 } })).id;
    pizzasId = (await sembrarProductoDisponible({ codigo: "PV_PIZZAS", nombre: "Pizzas", tipo: "PV", precioVenta: 18000, unidadStockId: u.id }, sucursalId)).id;
  });

  it("prenderlo y apagarlo deja una fila de auditoría por cambio, con la sucursal; repetir el mismo valor no deja otra", async () => {
    expect((await guardar({ mostrarNombreArriba: true })).ok).toBe(true);
    expect((await fila())?.mostrarNombreArriba).toBe(true);
    expect((await guardar({ mostrarNombreArriba: true })).ok, "repetir").toBe(true);
    expect((await guardar({ mostrarNombreArriba: false })).ok).toBe(true);
    expect((await guardar({ mostrarNombreArriba: false })).ok, "repetir").toBe(true);
    expect((await fila())?.mostrarNombreArriba).toBe(false);
    const registros = await auditoria();
    expect(registros.map((r) => [r.entidadId, r.valorAnterior, r.valorNuevo, r.sucursalId])).toEqual([
      [`${sucursalId}:${pizzasId}`, "false", "true", sucursalId],
      [`${sucursalId}:${pizzasId}`, "true", "false", sucursalId],
    ]);
    expect(registros[0]!.descripcion).toContain("«Pizzas» con el nombre arriba");
  });

  it("un contenido nuevo con el interruptor apagado no deja auditoría (es el default); un pedido sin la clave no lo toca ni audita", async () => {
    expect((await guardar({ mostrarNombreArriba: false })).ok).toBe(true);
    expect(await auditoria()).toEqual([]);
    expect((await guardar({ mostrarNombreArriba: true })).ok).toBe(true);
    expect((await guardar({ descripcion: "Otra descripción" })).ok, "un formulario sin la clave").toBe(true);
    const despues = await fila();
    expect(despues).toMatchObject({ mostrarNombreArriba: true, descripcion: "Otra descripción" });
    expect(await auditoria()).toHaveLength(1);
  });

  it("un valor que no es un sí o un no se rechaza sin escribir nada", async () => {
    for (const malo of ["true", 1, null, {}]) {
      const r = await guardar({ mostrarNombreArriba: malo });
      expect(r, JSON.stringify(malo)).toMatchObject({ ok: false, mensaje: "«Mostrar el nombre del producto arriba» no es válido." });
    }
    expect(await fila()).toBeNull();
    expect(await auditoria()).toEqual([]);
  });

  it("sin el permiso `carta_contenido_producto` no escribe ni audita; con él, escribe en la sucursal activa y nunca en otra", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: operadorRolId });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    expect((await guardar({ mostrarNombreArriba: true })).ok).toBe(false);
    expect(await fila()).toBeNull();
    expect(await auditoria()).toEqual([]);

    const admin = await prisma.user.findFirstOrThrow({ where: { email: "admin@test.com" } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    expect((await guardar({ mostrarNombreArriba: true })).ok).toBe(true);
    expect((await fila())?.mostrarNombreArriba).toBe(true);
    expect(await fila(otraSucursalId)).toBeNull();
  });
});
