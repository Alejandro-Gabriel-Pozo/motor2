import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
const falla = vi.hoisted(() => ({ activa: false }));
vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...original,
    registrarCambioAuditado: (...args: Parameters<typeof original.registrarCambioAuditado>) => {
      if (falla.activa) throw new Error("falla simulada de auditoría");
      return original.registrarCambioAuditado(...args);
    },
  };
});

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarCapacidad } from "../../src/server/actions/permisos/capacidades-sucursal";

// S-26: si la auditoría falla, el cambio de capacidad no queda a medias.
describe("actualizarCapacidad: cambio y auditoría en una sola transacción", () => {
  let sucursalId: string;

  beforeEach(async () => {
    falla.activa = false;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    // O.41: cambiar una capacidad es solo del gerente; este test es sobre la atomicidad del cambio y su auditoría, así que quien actúa es el gerente.
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("alta: si falla la auditoría no queda la fila", async () => {
    falla.activa = true;
    await expect(actualizarCapacidad("proceso_venta", sucursalId, false)).rejects.toThrow();
    expect(await prisma.capacidadSucursal.count()).toBe(0);
  });

  it("cambio: si falla la auditoría la fila conserva su valor", async () => {
    await actualizarCapacidad("proceso_venta", sucursalId, false);
    falla.activa = true;
    await expect(actualizarCapacidad("proceso_venta", sucursalId, true)).rejects.toThrow();
    expect((await prisma.capacidadSucursal.findFirstOrThrow({ where: { sucursalId } })).habilitado).toBe(false);
  });
});
