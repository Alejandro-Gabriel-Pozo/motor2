import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { altaCliente, actualizarCliente, actualizarActivoCliente } from "../../src/server/actions/clientes/cliente";
import { abrirCuenta, asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";

/**
 * Auditoría de Clientes y de la asignación de un cliente a una cuenta, contra Postgres real y con las acciones reales: el % de descuento
 * mueve plata (se congela en la cuenta al asignarlo), así que alta, edición, activar/desactivar y asignar/quitar dejan quién y cuándo.
 */
describe("auditoría de clientes", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  // Las filas de UNA acción se comparan por campo (el orden de inserción dentro de la acción no es parte del contrato); entre acciones
  // distintas se separa por instante, así que cada comparación toma las filas nuevas desde `desde`.
  const filasDe = async (entidadId: string, desde: string[] = []) =>
    (await prisma.registroAuditoria.findMany({ where: { entidadId, id: { notIn: desde } } })).sort((a, b) => a.campo.localeCompare(b.campo));
  const crear = async (nombre: string, pct: number) => {
    const r = await altaCliente(nombre, pct);
    if (!r.ok) throw new Error(r.mensaje);
    return r.id;
  };

  it("el alta deja el nombre y el % con su actor, sin sucursal (es del catálogo central)", async () => {
    const id = await crear("Fulano", 15);
    const filas = await filasDe(id);
    expect(filas.map((f) => [f.entidad, f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["Cliente", "descuentoPorcentaje", null, "15"],
      ["Cliente", "nombre", null, "Fulano"],
    ]);
    expect(filas.every((f) => f.actorId === s.admin.id && f.sucursalId === null)).toBe(true);
  });

  it("editar deja SOLO lo que cambió, y no deja nada si no cambió nada", async () => {
    const id = await crear("Fulano", 15);
    await prisma.registroAuditoria.deleteMany({ where: { entidadId: id } });

    expect((await actualizarCliente(id, "Fulano", 15)).ok).toBe(true);
    expect(await filasDe(id)).toHaveLength(0);

    expect((await actualizarCliente(id, "Fulano", 25)).ok).toBe(true);
    const filas = await filasDe(id);
    expect(filas.map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([["descuentoPorcentaje", "15", "25"]]);

    expect((await actualizarCliente(id, "Fulano Pérez", 25)).ok).toBe(true);
    expect((await filasDe(id)).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toContainEqual(["nombre", "Fulano", "Fulano Pérez"]);
  });

  it("desactivar y reactivar dejan una fila cada uno", async () => {
    const id = await crear("Fulano", 10);
    await prisma.registroAuditoria.deleteMany({ where: { entidadId: id } });
    expect((await actualizarActivoCliente(id, false)).ok).toBe(true);
    expect((await actualizarActivoCliente(id, true)).ok).toBe(true);
    expect((await filasDe(id)).map((f) => [f.campo, f.valorAnterior, f.valorNuevo]).sort()).toEqual([
      ["activo", "false", "true"],
      ["activo", "true", "false"],
    ]);
  });

  it("un alta rechazada (nombre repetido) no deja rastro", async () => {
    await crear("Fulano", 10);
    const antes = await prisma.registroAuditoria.count({ where: { entidad: "Cliente" } });
    expect((await altaCliente("fulano", 20)).ok).toBe(false);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Cliente" } })).toBe(antes);
  });

  it("asignar un cliente a la cuenta deja cliente y % de la cuenta, con la sucursal; quitarlo deja el camino de vuelta", async () => {
    const clienteId = await crear("Mengano", 20);
    expect((await abrirCuenta(s.mesa.id, 2)).ok).toBe(true);
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });

    expect((await asignarClienteACuenta(cuenta.id, clienteId)).ok).toBe(true);
    const filas = await filasDe(cuenta.id);
    expect(filas.map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["cliente", null, "Mengano"],
      ["descuentoPorcentaje", null, "20"],
    ]);
    expect(filas.every((f) => f.actorId === s.admin.id && f.sucursalId === s.sucursalId)).toBe(true);

    expect((await asignarClienteACuenta(cuenta.id, null)).ok).toBe(true);
    expect((await filasDe(cuenta.id, filas.map((f) => f.id))).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
      ["cliente", "Mengano", null],
      ["descuentoPorcentaje", "20", null],
    ]);
  });

  it("asignar el mismo cliente dos veces no ensucia el registro", async () => {
    const clienteId = await crear("Mengano", 20);
    await abrirCuenta(s.mesa.id, 2);
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });
    await asignarClienteACuenta(cuenta.id, clienteId);
    const antes = await prisma.registroAuditoria.count({ where: { entidadId: cuenta.id } });
    await asignarClienteACuenta(cuenta.id, clienteId);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: cuenta.id } })).toBe(antes);
  });

  it("asignar un cliente desactivado se rechaza y no deja rastro", async () => {
    const clienteId = await crear("Zutano", 10);
    await actualizarActivoCliente(clienteId, false);
    await abrirCuenta(s.mesa.id, 2);
    const cuenta = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id, cerradaEn: null } });
    expect((await asignarClienteACuenta(cuenta.id, clienteId)).ok).toBe(false);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: cuenta.id } })).toBe(0);
  });
});
