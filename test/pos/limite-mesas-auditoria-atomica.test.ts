import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
const falla = vi.hoisted(() => ({ auditoria: false, cambio: false }));
vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...original,
    registrarCambioAuditado: (...args: Parameters<typeof original.registrarCambioAuditado>) => {
      if (falla.auditoria) throw new Error("falla simulada de auditoría");
      return original.registrarCambioAuditado(...args);
    },
  };
});
vi.mock("../../src/server/persistencia/pos/mesas", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/persistencia/pos/mesas")>();
  return {
    ...original,
    fijarMaxMesasAbiertas: (...args: Parameters<typeof original.fijarMaxMesasAbiertas>) => {
      if (falla.cambio) throw new Error("falla simulada del cambio del límite");
      return original.fijarMaxMesasAbiertas(...args);
    },
  };
});

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarMaxMesasAbiertas } from "../../src/server/actions/pos/mesas";

/**
 * B1 del Hito 4 (aprobado por el dueño, 2026-10-08; `docs/plan-hito-4-pureza.md` §5): el límite de mesas abiertas de la sucursal y su fila de auditoría se
 * escriben en UNA transacción — o quedan los dos, o ninguno. Molde: `test/seguridad/capacidad-auditoria-atomica.test.ts` (S-26).
 *
 * Antes de B1 la auditoría iba con la base del contexto ANTES del cambio y sin transacción: si el cambio fallaba, quedaba una fila de auditoría de un cambio
 * que nunca ocurrió (el segundo caso, rojo contra ese código). Si falla la auditoría, el límite no cambia (el primer caso: verde antes y después; se fija
 * igual, porque la transacción no puede romperlo).
 */
describe("actualizarMaxMesasAbiertas: el límite y su auditoría en una sola transacción", () => {
  let sucursalId: string;

  beforeEach(async () => {
    falla.auditoria = false;
    falla.cambio = false;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const limite = async () => (await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } })).maxMesasAbiertas;
  const filasDeAuditoria = () => prisma.registroAuditoria.count({ where: { entidad: "Sucursal", entidadId: sucursalId, campo: "maxMesasAbiertas" } });

  it("si falla la auditoría, el límite queda como estaba y no hay fila nueva", async () => {
    await actualizarMaxMesasAbiertas(5);
    falla.auditoria = true;
    await expect(actualizarMaxMesasAbiertas(8)).rejects.toThrow("falla simulada de auditoría");
    expect(await limite()).toBe(5);
    expect(await filasDeAuditoria()).toBe(1);
  });

  it("si falla el cambio, no queda la fila de auditoría de un cambio que no ocurrió", async () => {
    await actualizarMaxMesasAbiertas(5);
    falla.cambio = true;
    await expect(actualizarMaxMesasAbiertas(8)).rejects.toThrow("falla simulada del cambio del límite");
    expect(await limite()).toBe(5);
    expect(await filasDeAuditoria()).toBe(1);
  });
});
