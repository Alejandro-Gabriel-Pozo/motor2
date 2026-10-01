import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMesa } from "../../src/server/actions/pos/mesas";

/** Alta de mesa (src/server/actions/pos/mesas.ts): validación, número único por sucursal y la guarda de Editar de `pos_alta_mesa`. */
describe("crearMesa (server action)", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const mesasDe = (id: string) => prisma.mesa.findMany({ where: { sucursalId: id }, orderBy: { numero: "asc" } });

  it("un admin crea una mesa en su sucursal activa", async () => {
    const r = await crearMesa(4);
    expect(r).toEqual({ ok: true, mensaje: "Mesa 4 creada." });
    expect((await mesasDe(sucursalId)).map((m) => m.numero)).toEqual([4]);
  });

  it("un número repetido en la misma sucursal da el mensaje de negocio y no crea nada", async () => {
    await crearMesa(4);
    const r = await crearMesa(4);
    expect(r).toEqual({ ok: false, mensaje: "Ya existe la mesa 4 en esta sucursal." });
    expect(await mesasDe(sucursalId)).toHaveLength(1);
  });

  it("rechaza números no enteros, fuera de rango o que no son números", async () => {
    for (const numero of [0, -1, 1.5, NaN, Infinity, 10000]) {
      const r = await crearMesa(numero);
      expect(r.ok, `crearMesa(${numero})`).toBe(false);
      expect(r.mensaje).toBe("El número de mesa tiene que ser un entero entre 1 y 9999.");
    }
    expect(await crearMesa(9999)).toMatchObject({ ok: true });
    expect((await mesasDe(sucursalId)).map((m) => m.numero)).toEqual([9999]);
  });

  it("el mismo número en otra sucursal está permitido", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    expect(await crearMesa(1)).toMatchObject({ ok: true });
    expect(await prisma.mesa.count({ where: { numero: 1 } })).toBe(2);
  });

  it("un rol sin pos_alta_mesa (el operador de fábrica) no puede", async () => {
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await crearMesa(1);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await mesasDe(sucursalId)).toEqual([]);
  });

  it("con Ver pero sin Editar de pos_alta_mesa, tampoco", async () => {
    await prisma.permisoRol.update({ where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "pos_alta_mesa" } }, data: { puedeVer: true, puedeEditar: false } });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const r = await crearMesa(1);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/No tenés permiso/);
    expect(await mesasDe(sucursalId)).toEqual([]);
  });

  it("si la Central deshabilitó pos_alta_mesa para la sucursal, ni el admin puede", async () => {
    await prisma.capacidadSucursal.create({ data: { accionClave: "pos_alta_mesa", sucursalId, habilitado: false } });
    const r = await crearMesa(1);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/no habilitó "pos_alta_mesa"/);
    expect(await mesasDe(sucursalId)).toEqual([]);
  });
});
