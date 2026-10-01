import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

const politica = vi.hoisted(() => ({ permisosEditables: true }));
vi.mock("../../src/core/permisos/politica-de-empresa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/permisos/politica-de-empresa")>()),
  politicaDeEmpresa: vi.fn(async () => ({ permisosEditables: politica.permisosEditables })),
}));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "../../src/core/permisos/politica-de-empresa";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { actualizarActivoRol, crearRol } from "../../src/server/actions/permisos/roles";

/**
 * Add-on de plataforma (ADR-008): si la plataforma no le deja a la empresa editar permisos, las tres acciones que escriben `PermisoRol`/`Rol`
 * (`guardarPermisos`, `crearRol`, `actualizarActivoRol`) devuelven el mensaje de la plataforma y no escriben NADA (ni la fila ni su auditoría).
 * Con la política en `true` (el valor de hoy) siguen funcionando igual.
 */
describe("conEdicionDePermisos: la política de la empresa corta la edición de permisos", () => {
  let operadorRolId: string;

  const estado = async () => ({
    permisos: await prisma.permisoRol.count(),
    roles: await prisma.rol.count(),
    auditoria: await prisma.registroAuditoria.count(),
  });

  beforeEach(async () => {
    politica.permisosEditables = true;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    operadorRolId = base.operador.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("con la política en false, las tres acciones devuelven el mensaje de la plataforma y no escriben nada", async () => {
    politica.permisosEditables = false;
    const antes = await estado();
    const anterior = { puedeVer: false, puedeEditar: false };

    expect(await crearRol("cajero")).toEqual({ ok: false, mensaje: MENSAJE_PERMISOS_DE_PLATAFORMA });
    expect(await actualizarActivoRol(operadorRolId, false)).toEqual({ ok: false, mensaje: MENSAJE_PERMISOS_DE_PLATAFORMA });
    expect(await guardarPermisos([{ rolId: operadorRolId, accionClave: "proceso_venta", anterior, nuevo: { puedeVer: true, puedeEditar: true } }])).toEqual({
      ok: false,
      mensaje: MENSAJE_PERMISOS_DE_PLATAFORMA,
    });

    expect(await estado()).toEqual(antes);
    expect((await prisma.rol.findUniqueOrThrow({ where: { id: operadorRolId } })).activo).toBe(true);
  });

  it("con la política en true (hoy), crearRol y actualizarActivoRol escriben como siempre", async () => {
    const antes = await estado();
    const creado = await crearRol("cajero");
    expect(creado.ok, creado.ok ? "" : creado.mensaje).toBe(true);
    const apagado = await actualizarActivoRol(operadorRolId, false);
    expect(apagado.ok, apagado.ok ? "" : apagado.mensaje).toBe(true);
    const despues = await estado();
    expect(despues.roles).toBe(antes.roles + 1);
    expect(despues.auditoria).toBe(antes.auditoria + 1);
  });
});
