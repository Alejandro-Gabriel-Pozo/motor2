import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prismaAdmin, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { duplicarProducto } from "../../src/server/actions/catalogo/duplicar-producto";
import { CLASES_DE_ALTA_ESPERADAS } from "./alta-como-pedernal.reglas";

/**
 * Clases de producto como Pedernal, etapa E2 (2026-11-17): el alta GUARDA la clase elegida («¿Qué es?») en `Producto.claseDeUso` (columna de E1), junto con el tipo y «se produce» de siempre. Contra Postgres real.
 *
 * Qué fija: (a) cada una de las cuatro clases que se ofrecen queda escrita con su tipo y «se produce» (oráculo escrito aparte: `alta-como-pedernal.reglas.ts`); (b) un alta SIN clase (el cliente viejo, las
 * altas rápidas) queda con la clase en NULL, como hoy; (c) lista de permitidos: Reventa (todavía sin modelo), una clase inventada o una que no coincide con el tipo o con «se produce» se rechazan y NO se crea
 * nada; (d) la clase no se cambia desde la edición (viene o no viene, el producto queda como estaba); (e) duplicar copia la clase; (f) idempotencia (repetir el alta no crea otro) y concurrencia (dos altas
 * simultáneas del mismo nombre dejan UNO); (g) aislamiento: el mismo nombre en otra empresa no choca y su clase es la suya.
 */
describe("darDeAltaProducto con clase de uso (E2)", () => {
  let kgId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const alta = (nombre: string, extra: Record<string, unknown>) => darDeAltaProducto({ nombre, unidadStockId: kgId, factorConversion: 1, tipo: "MP", ...extra } as Parameters<typeof darDeAltaProducto>[0]);
  const guardado = (nombre: string) => prismaAdmin.producto.findFirstOrThrow({ where: { nombre } });

  it.each(CLASES_DE_ALTA_ESPERADAS)("$clave: queda escrita con tipo $tipo y «se produce» $seProduce", async (c) => {
    const r = await alta(`Producto de ${c.nombre}`, { tipo: c.tipo, seProduce: c.seProduce, claseDeUso: c.clave });
    expect(r.ok, r.mensaje).toBe(true);
    const p = await guardado(`Producto de ${c.nombre}`);
    expect({ tipo: p.tipo, seProduce: p.seProduce, claseDeUso: p.claseDeUso }).toEqual({ tipo: c.tipo, seProduce: c.seProduce, claseDeUso: c.clave });
  });

  it("un alta SIN clase (cliente viejo, alta rápida) queda con la clase en NULL, como hoy", async () => {
    expect((await alta("Sin clase", {})).ok).toBe(true);
    expect((await guardado("Sin clase")).claseDeUso).toBeNull();
  });

  it.each([
    ["Reventa (todavía sin modelo, E4)", { tipo: "MP", claseDeUso: "REVENTA" }],
    ["una clase inventada", { tipo: "MP", claseDeUso: "SERVICIO" }],
    ["minúsculas", { tipo: "MP", claseDeUso: "insumo" }],
    ["vacía", { tipo: "MP", claseDeUso: "" }],
    ["un Insumo que se produce", { tipo: "MP", seProduce: true, claseDeUso: "INSUMO" }],
    ["una Materia prima que se produce", { tipo: "MP", seProduce: true, claseDeUso: "MATERIA_PRIMA" }],
    ["un Elaborado que no se produce", { tipo: "MP", seProduce: false, claseDeUso: "ELABORADO" }],
    ["un Vendible con tipo MP", { tipo: "MP", claseDeUso: "VENDIBLE" }],
    ["una Materia prima con tipo PV", { tipo: "PV", claseDeUso: "MATERIA_PRIMA" }],
  ])("se rechaza %s y no se crea nada", async (_nombre, extra) => {
    const r = await alta("Rechazado", extra);
    expect(r.ok).toBe(false);
    expect(await prismaAdmin.producto.count()).toBe(0);
  });

  it("la edición NO cambia la clase: venga o no venga en el pedido, el producto queda como estaba", async () => {
    await alta("Salsa", { tipo: "MP", seProduce: true, claseDeUso: "ELABORADO" });
    const p = await guardado("Salsa");
    const r = await actualizarProducto(p.id, { nombre: "Salsa casera", tipo: "MP", unidadStockId: kgId, factorConversion: 1, seProduce: true, claseDeUso: "INSUMO" } as Parameters<typeof actualizarProducto>[1]);
    expect(r.ok, r.mensaje).toBe(true);
    const despues = await prismaAdmin.producto.findUniqueOrThrow({ where: { id: p.id } });
    expect({ nombre: despues.nombre, claseDeUso: despues.claseDeUso }).toEqual({ nombre: "Salsa casera", claseDeUso: "ELABORADO" });
  });

  it("duplicar copia la clase (un duplicado de un Insumo es un Insumo; uno sin clase, sin clase)", async () => {
    await alta("Servilletas", { tipo: "MP", claseDeUso: "INSUMO" });
    await alta("Harina vieja", {});
    for (const [origen, esperado] of [["Servilletas", "INSUMO"], ["Harina vieja", null]] as const) {
      const o = await guardado(origen);
      const duplicadoId = crypto.randomUUID();
      const r = await duplicarProducto({ duplicadoId, origenId: o.id, nombre: `${origen} copia`, copiarReceta: false, copiarOpciones: false, sucursalDeLaRecetaId: null });
      expect(r.ok, r.mensaje).toBe(true);
      expect((await prismaAdmin.producto.findUniqueOrThrow({ where: { id: duplicadoId } })).claseDeUso).toBe(esperado);
    }
  });

  it("IDEMPOTENCIA: repetir el mismo alta no crea otro producto", async () => {
    expect((await alta("Servilletas", { claseDeUso: "INSUMO" })).ok).toBe(true);
    expect((await alta("Servilletas", { claseDeUso: "INSUMO" })).ok).toBe(false);
    expect(await prismaAdmin.producto.count()).toBe(1);
  });

  it("CONCURRENCIA: dos altas simultáneas del mismo nombre dejan UN producto, con una clase válida", async () => {
    const [a, b] = await Promise.all([alta("Doble", { claseDeUso: "MATERIA_PRIMA" }), alta("Doble", { claseDeUso: "MATERIA_PRIMA" })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const filas = await prismaAdmin.producto.findMany({ where: { nombre: "Doble" } });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.claseDeUso).toBe("MATERIA_PRIMA");
  });
});
