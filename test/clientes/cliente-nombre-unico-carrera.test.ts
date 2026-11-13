import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaCliente } from "../../src/server/actions/clientes/cliente";

/**
 * Paso 11 de la auditoría (migración 20261112170000_nombre_unico_sin_mayusculas, riesgo R2): el nombre de un cliente es único por empresa SIN distinguir mayúsculas, también
 * cuando dos altas llegan a la vez (las dos pasan la lectura previa; el índice único sobre lower(nombre) deja una sola). Concurrencia: «Pepe» y «pepe» simultáneos.
 * Idempotencia: la misma alta repetida no crea otro cliente. Atomicidad: la que pierde no deja filas de auditoría a medias.
 * Mutación demostrada: sacar el índice de la migración hace caer «dos altas simultáneas dejan un solo cliente».
 */
describe("clientes: el nombre es único sin distinguir mayúsculas, también en la carrera", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const cuantos = () => prismaAdmin.cliente.count();
  const filasDeAuditoria = () => prismaAdmin.registroAuditoria.count({ where: { entidad: "Cliente" } });

  it("dos altas simultáneas con el mismo nombre (distinta capitalización) dejan un solo cliente y la otra se rechaza", async () => {
    const resultados = await Promise.all([altaCliente("Pepe Carrera", 10), altaCliente("pepe carrera", 10)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok)).toHaveLength(1);
    expect(await cuantos()).toBe(1);
    expect(await filasDeAuditoria(), "el alta ganadora deja sus 2 filas; la perdedora ninguna").toBe(2);
  });

  it("repetir la misma alta no crea otro cliente (idempotencia)", async () => {
    expect((await altaCliente("Repetido", 5)).ok).toBe(true);
    expect((await altaCliente("Repetido", 5)).ok).toBe(false);
    expect(await cuantos()).toBe(1);
  });

  it("la base misma rechaza el duplicado sin distinguir mayúsculas (índice único)", async () => {
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "Cliente" (id, "empresaId", nombre, "descuentoPorcentaje") VALUES ('c_a', 'empresa_principal', 'Ana', 0)`);
    await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "Cliente" (id, "empresaId", nombre, "descuentoPorcentaje") VALUES ('c_b', 'empresa_principal', 'ANA', 0)`)).rejects.toThrow(/Cliente_empresaId_nombre_lower_key/);
  });

  it("la base misma rechaza una sección de carta repetida sin distinguir mayúsculas (índice único)", async () => {
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "SeccionCarta" (id, "empresaId", nombre) VALUES ('s_a', 'empresa_principal', 'Postres')`);
    await expect(prismaAdmin.$executeRawUnsafe(`INSERT INTO "SeccionCarta" (id, "empresaId", nombre) VALUES ('s_b', 'empresa_principal', 'POSTRES')`)).rejects.toThrow(/SeccionCarta_empresaId_nombre_lower_key/);
  });
});
