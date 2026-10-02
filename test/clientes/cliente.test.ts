import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaCliente, actualizarCliente, actualizarActivoCliente, listarClientes, listarClientesParaCuenta } from "../../src/server/actions/clientes/cliente";

/**
 * CRUD de Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md): catálogo central, admin-only (permiso
 * `clientes`), mismo molde de dedup case-insensible que `proveedores.ts`/`categorias-producto.ts` — a diferencia de Proveedor, acá
 * el nombre SÍ se puede corregir (sin un "código" separado que sea la identidad).
 */
describe("Cliente (CRUD)", () => {
  let sucursalId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolOperadorId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  describe("altaCliente", () => {
    it("da de alta un cliente con su % de descuento", async () => {
      const r = await altaCliente("Fulano", 15);
      expect(r.ok, r.mensaje).toBe(true);
      if (!r.ok) return;
      expect(r.mensaje).toBe('Cliente "Fulano" creado, con 15% de descuento.');
      const creado = await prisma.cliente.findUniqueOrThrow({ where: { id: r.id } });
      expect(creado.nombre).toBe("Fulano");
      expect(Number(creado.descuentoPorcentaje)).toBe(15);
      expect(creado.activo).toBe(true);
    });

    it("0% es válido (cliente sin descuento hoy, que puede tenerlo mañana)", async () => {
      const r = await altaCliente("Sin descuento todavía", 0);
      expect(r.ok, r.mensaje).toBe(true);
    });

    it("rechaza nombre vacío", async () => {
      expect((await altaCliente("", 10)).ok).toBe(false);
      expect((await altaCliente("   ", 10)).ok).toBe(false);
    });

    it("rechaza un % inválido (negativo, ≥100, o texto que no es un número) sin crear nada", async () => {
      for (const pct of [-1, 100, 150, "abc", undefined]) {
        const r = await altaCliente("Alguien", pct);
        expect(r.ok, `pct=${pct}`).toBe(false);
      }
      expect(await prisma.cliente.count()).toBe(0);
    });

    it("dedup case-insensible: no se puede repetir un nombre", async () => {
      await altaCliente("Fulano", 10);
      const r = await altaCliente("FULANO", 20);
      expect(r).toEqual({ ok: false, mensaje: 'Ya existe un cliente llamado "Fulano".' });
      expect(await prisma.cliente.count()).toBe(1);
    });
  });

  describe("actualizarCliente", () => {
    it("corrige nombre y %", async () => {
      const creado = await altaCliente("Fulano", 10);
      if (!creado.ok) throw new Error("esperaba ok");

      const r = await actualizarCliente(creado.id, "Fulano Corregido", 20);
      expect(r).toEqual({ ok: true, mensaje: 'Cliente "Fulano Corregido" actualizado.' });
      const actualizado = await prisma.cliente.findUniqueOrThrow({ where: { id: creado.id } });
      expect(actualizado.nombre).toBe("Fulano Corregido");
      expect(Number(actualizado.descuentoPorcentaje)).toBe(20);
    });

    it("rechaza un cliente inexistente, un % inválido, o un nombre ya usado por otro cliente", async () => {
      const uno = await altaCliente("Uno", 10);
      const dos = await altaCliente("Dos", 20);
      if (!uno.ok || !dos.ok) throw new Error("esperaba ok");

      expect((await actualizarCliente("no-existe", "X", 10)).ok).toBe(false);
      expect((await actualizarCliente(uno.id, "Uno", 150)).ok).toBe(false);
      expect((await actualizarCliente(uno.id, "DOS", 10)).ok).toBe(false); // ya lo usa "Dos" (case-insensible)
      expect((await actualizarCliente(uno.id, "Uno", 10)).ok).toBe(true); // su propio nombre sí vale
    });

    it("el % nuevo NO reescribe una Cuenta que ya lo tenía congelado (D7 — verificado en test/pos/cliente-descuento.test.ts)", async () => {
      // Cobertura completa del snapshot en test/pos/cliente-descuento.test.ts; acá solo se confirma que esta action en sí no
      // toca ninguna Cuenta.
      const creado = await altaCliente("Fulano", 10);
      if (!creado.ok) throw new Error("esperaba ok");
      await actualizarCliente(creado.id, "Fulano", 50);
      expect(await prisma.cuenta.count()).toBe(0); // esta action ni sabe qué es una Cuenta
    });
  });

  describe("actualizarActivoCliente", () => {
    it("desactiva y reactiva", async () => {
      const creado = await altaCliente("Fulano", 10);
      if (!creado.ok) throw new Error("esperaba ok");

      expect((await actualizarActivoCliente(creado.id, false)).mensaje).toBe('Cliente "Fulano" desactivado.');
      expect((await prisma.cliente.findUniqueOrThrow({ where: { id: creado.id } })).activo).toBe(false);

      expect((await actualizarActivoCliente(creado.id, true)).mensaje).toBe('Cliente "Fulano" activado.');
      expect((await prisma.cliente.findUniqueOrThrow({ where: { id: creado.id } })).activo).toBe(true);
    });

    it("rechaza un cliente inexistente", async () => {
      expect((await actualizarActivoCliente("no-existe", false)).ok).toBe(false);
    });
  });

  describe("listarClientes / listarClientesParaCuenta", () => {
    it("listarClientes ordena por nombre e incluye a los desactivados", async () => {
      const b = await altaCliente("Beta", 10);
      const a = await altaCliente("Alfa", 20);
      if (!a.ok || !b.ok) throw new Error("esperaba ok");
      await actualizarActivoCliente(b.id, false);

      expect((await listarClientes()).map((c) => c.nombre)).toEqual(["Alfa", "Beta"]);
    });

    it("listarClientesParaCuenta devuelve solo los activos y solo id/nombre/% (number), nunca la fila completa (S-25)", async () => {
      const b = await altaCliente("Beta", 10);
      const a = await altaCliente("Alfa", 20);
      if (!a.ok || !b.ok) throw new Error("esperaba ok");
      await actualizarActivoCliente(b.id, false);

      expect(await listarClientesParaCuenta()).toEqual([{ id: a.id, nombre: "Alfa", descuentoPorcentaje: 20 }]);
    });

    it("listarClientes exige el «Ver» de 'clientes' (un operador de fábrica no lo tiene); la lectura mínima del salón pide 'pos_asignar_cliente'", async () => {
      const operador = await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId, rolId: rolOperadorId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

      await expect(listarClientes()).rejects.toThrow(/No tenés permiso/);
      await expect(listarClientesParaCuenta()).rejects.toThrow(/No tenés permiso/);

      await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: rolOperadorId, accionClave: "pos_asignar_cliente" } }, data: { puedeVer: true, puedeEditar: true } });
      await expect(listarClientesParaCuenta()).resolves.toEqual([]);
    });
  });

  describe("permiso", () => {
    it("sin el permiso 'clientes' (un operador de fábrica) no se puede dar de alta ni tocar", async () => {
      const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: rolOperadorId });
      await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });

      const r = await altaCliente("Fulano", 10);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain('"clientes"');
    });
  });
});
