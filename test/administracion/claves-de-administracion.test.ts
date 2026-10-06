import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoSucursal, renombrarSucursal } from "../../src/server/actions/auth/sucursales";
import { actualizarActivoMembresia, actualizarActivoUsuarioEnEmpresa, actualizarNotasMembresia } from "../../src/server/actions/auth/usuarios";
import { actualizarActivoRol, crearRol, listarRoles } from "../../src/server/actions/permisos/roles";

/**
 * Una clave por acción de administración: cada acción se gobierna con la suya, no con la del grupo del que salió. El «admin» de la base de pruebas
 * trae todas las filas; acá se le quita UNA y se comprueba que solo esa acción se cierra y que las demás siguen abiertas (y al revés: tener
 * la fila madre —`gestion_usuarios`, `gestion_permisos`, `alta_sucursal`— no alcanza para las hijas).
 */
type Escenario = Awaited<ReturnType<typeof armar>>;

async function armar() {
  const base = await sembrarBase();
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  const otro = await crearUsuarioConMembresia({ email: "otro@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
  const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra sucursal" } });
  const membresiaOtro = await prisma.usuarioSucursal.findFirstOrThrow({ where: { usuarioId: otro.id, sucursalId: base.sucursal.id } });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  return { base, admin, otro, otraSucursal, membresiaOtro };
}

const quitarClave = (e: Escenario, accionClave: string) => prismaAdmin.permisoRol.deleteMany({ where: { rolId: e.base.admin.id, accionClave } });

describe("claves de administración: una por acción", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("activar o desactivar una membresía pide `activar_usuario_sucursal`", async () => {
    const e = await armar();
    await quitarClave(e, "activar_usuario_sucursal");
    expect((await actualizarActivoMembresia(e.membresiaOtro.id, false)).ok).toBe(false);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: e.membresiaOtro.id } })).activo).toBe(true);
    // Las notas, que se separaron de ella, siguen abiertas.
    expect((await actualizarNotasMembresia(e.membresiaOtro.id, "nota")).ok).toBe(true);
  });

  it("las notas de una membresía piden `notas_usuario_sucursal`", async () => {
    const e = await armar();
    await quitarClave(e, "notas_usuario_sucursal");
    expect((await actualizarNotasMembresia(e.membresiaOtro.id, "nota")).ok).toBe(false);
    expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: e.membresiaOtro.id } })).notas).not.toBe("nota");
    expect((await actualizarActivoMembresia(e.membresiaOtro.id, false)).ok).toBe(true);
  });

  it("apagar la cuenta en la empresa pide `apagar_cuenta_empresa`", async () => {
    const e = await armar();
    await quitarClave(e, "apagar_cuenta_empresa");
    expect((await actualizarActivoUsuarioEnEmpresa(e.otro.id, false)).ok).toBe(false);
    const empresaId = e.base.sucursal.empresaId;
    expect((await prismaAdmin.usuarioEmpresa.findUniqueOrThrow({ where: { usuarioId_empresaId: { usuarioId: e.otro.id, empresaId } } })).activo).toBe(true);
  });

  it("tener `gestion_usuarios` sin las claves hijas no alcanza para activar, anotar ni apagar", async () => {
    const e = await armar();
    for (const clave of ["activar_usuario_sucursal", "notas_usuario_sucursal", "apagar_cuenta_empresa"]) await quitarClave(e, clave);
    expect((await actualizarActivoMembresia(e.membresiaOtro.id, false)).ok).toBe(false);
    expect((await actualizarNotasMembresia(e.membresiaOtro.id, "x")).ok).toBe(false);
    expect((await actualizarActivoUsuarioEnEmpresa(e.otro.id, false)).ok).toBe(false);
  });

  it("activar o desactivar una sucursal pide `activar_sucursal` y renombrarla, `renombrar_sucursal`", async () => {
    const e = await armar();
    await quitarClave(e, "activar_sucursal");
    expect((await actualizarActivoSucursal(e.otraSucursal.id, false)).ok).toBe(false);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: e.otraSucursal.id } })).activo).toBe(true);
    expect((await renombrarSucursal(e.otraSucursal.id, "Con otro nombre")).ok).toBe(true);

    await quitarClave(e, "renombrar_sucursal");
    expect((await renombrarSucursal(e.otraSucursal.id, "Otro más")).ok).toBe(false);
    expect((await prisma.sucursal.findUniqueOrThrow({ where: { id: e.otraSucursal.id } })).nombre).toBe("Con otro nombre");
  });

  it("los roles se gobiernan con `gestion_roles`, no con `gestion_permisos`", async () => {
    const e = await armar();
    await quitarClave(e, "gestion_roles");
    expect((await crearRol("Encargado")).ok).toBe(false);
    expect(await prisma.rol.count({ where: { nombre: "Encargado" } })).toBe(0);
    await expect(listarRoles()).rejects.toThrow();
    expect((await actualizarActivoRol(e.base.operador.id, false)).ok).toBe(false);
  });

  it("con las claves nuevas puestas todo se abre", async () => {
    const e = await armar();
    expect((await crearRol("Encargado")).ok).toBe(true);
    expect((await actualizarActivoMembresia(e.membresiaOtro.id, false)).ok).toBe(true);
    expect((await actualizarActivoSucursal(e.otraSucursal.id, false)).ok).toBe(true);
  });

  it("un rol personalizado con la fila de una clave de administración no la tiene (piso administrador)", async () => {
    const e = await armar();
    const encargado = await prisma.rol.create({ data: { nombre: "encargado" } });
    for (const accionClave of ["activar_usuario_sucursal", "notas_usuario_sucursal", "activar_sucursal", "renombrar_sucursal", "gestion_roles"]) {
      await prismaAdmin.permisoRol.create({ data: { empresaId: e.base.sucursal.empresaId, rolId: encargado.id, accionClave, puedeVer: true, puedeEditar: true } });
    }
    const actor = await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId: e.base.sucursal.id, rolId: encargado.id });
    await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });

    expect((await actualizarActivoMembresia(e.membresiaOtro.id, false)).ok).toBe(false);
    expect((await actualizarNotasMembresia(e.membresiaOtro.id, "x")).ok).toBe(false);
    expect((await actualizarActivoSucursal(e.otraSucursal.id, false)).ok).toBe(false);
    expect((await renombrarSucursal(e.otraSucursal.id, "Nuevo")).ok).toBe(false);
    expect((await crearRol("Otro")).ok).toBe(false);
  });
});
