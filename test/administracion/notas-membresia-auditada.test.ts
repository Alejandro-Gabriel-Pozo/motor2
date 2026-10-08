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

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarNotasMembresia } from "../../src/server/actions/auth/usuarios";

/**
 * Decisión B4 del dueño (Hito 3, I.5a, commit aparte del movimiento a caso de uso): editar las notas de una membresía deja su fila en el registro de auditoría
 * (`UsuarioSucursal.notas`, de las notas anteriores a las nuevas, con quién lo hizo y en qué sucursal), en la MISMA transacción que la escritura. Antes no dejaba
 * ningún rastro. Postgres real, por la Server Action (sesión mockeada, como `usuarios.test.ts`).
 */
describe("actualizarNotasMembresia: las notas quedan auditadas, atómicas con la escritura", () => {
  let adminId: string;
  let membresiaId: string;
  let sucursalId: string;
  let rolOperadorId: string;
  const filas = () => prisma.registroAuditoria.findMany({ where: { entidad: "UsuarioSucursal", campo: "notas" }, orderBy: { creadoEn: "asc" } });

  beforeEach(async () => {
    falla.activa = false;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    rolOperadorId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id });
    adminId = admin.id;
    membresiaId = (await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: operador.id } })).id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("un cambio deja una fila con las notas anteriores y las nuevas, de quien actúa y en la sucursal de la membresía", async () => {
    expect((await actualizarNotasMembresia(membresiaId, "Encargado de turno noche")).ok).toBe(true);
    expect((await actualizarNotasMembresia(membresiaId, "  Turno mañana  ")).ok).toBe(true);
    const registro = await filas();
    expect(registro).toHaveLength(2);
    expect(registro[0]).toMatchObject({ entidadId: membresiaId, valorAnterior: null, valorNuevo: "Encargado de turno noche", actorId: adminId, sucursalId });
    expect(registro[1]).toMatchObject({ entidadId: membresiaId, valorAnterior: "Encargado de turno noche", valorNuevo: "Turno mañana", actorId: adminId, sucursalId });
    expect(registro[1].descripcion).toBe('Usuario "operador@test.com" en la sucursal "Central": notas');
  });

  it("borrarlas (texto vacío) deja la fila hacia sin notas; repetir el mismo valor no deja fila nueva", async () => {
    await actualizarNotasMembresia(membresiaId, "Algo");
    await actualizarNotasMembresia(membresiaId, "   ");
    await actualizarNotasMembresia(membresiaId, "");
    const registro = await filas();
    expect(registro.map((f) => [f.valorAnterior, f.valorNuevo])).toEqual([
      [null, "Algo"],
      ["Algo", null],
    ]);
  });

  it("un rechazo (membresía de otra sucursal) no escribe ni audita", async () => {
    const otra = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
    const ajeno = await crearUsuarioConMembresia({ email: "ajeno@test.com", sucursalId: otra.id, rolId: rolOperadorId });
    const ajena = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: ajeno.id } });
    expect((await actualizarNotasMembresia(ajena.id, "intento ajeno")).ok).toBe(false);
    expect(await filas()).toHaveLength(0);
  });

  it("si la auditoría falla, las notas no cambian (escritura y auditoría en una sola transacción)", async () => {
    await actualizarNotasMembresia(membresiaId, "Antes");
    falla.activa = true;
    await expect(actualizarNotasMembresia(membresiaId, "Después")).rejects.toThrow();
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresiaId } })).notas).toBe("Antes");
  });
});
