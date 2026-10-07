import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { nivelMinimoDeAccion } from "../../src/core/permisos/acciones";
import { requierePermisoDeEmpresa } from "../../src/server/acceso/gate";
import { agregarOActualizarUsuario } from "../../src/server/actions/auth/usuarios";
import { crearSucursalConAdmin } from "../../src/server/actions/auth/sucursales";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { renombrarRol } from "../../src/server/actions/permisos/roles";

/**
 * ─── F3 y D13/D14 lo editan a propósito ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * CARACTERIZACIÓN de los cuatro supuestos latentes del RBAC (O35-0 de `docs/plan-hito-3-pureza.md` §9; H2 de la evaluación del informe de RBAC; ADR-027).
 * Fija, contra Postgres real y por las Server Actions de verdad, lo que el sistema HACE HOY, aunque mañana deba hacer otra cosa:
 *
 *  (a) un admin crea una sucursal y se nombra primer admin a sí mismo o nombra a otro miembro de la empresa → se puede;
 *  (b) un admin se baja a sí mismo a operador mientras las invariantes de gobierno se cumplan; un operador no se sube a admin;
 *  (c) un admin que NO es el gerente edita la matriz del rol `admin` (celdas no fijas) → HOY SE PUEDE, y con eso le recorta acciones al gerente, que
 *      usa el mismo rol. D13/D14 (aprobado, commit propio al final del Hito 3) lo prohíbe: ese commit edita este caso a propósito;
 *  (d) el piso de una acción no depende de nada que cambie dentro de la transacción: sale del catálogo en código (la tabla `Accion` no lo guarda) y
 *      de la CLAVE del rol, que ninguna acción cambia (renombrar no la toca). Por eso `guardarPermisos` puede validarlo fuera de la transacción.
 *
 * Hoy ninguno se puede explotar porque solo el rol de clave `admin` alcanza el piso de gobierno. Cuando exista el rango 2 (F3: `Rol.nivel`, con migración y
 * autorización expresa) estos supuestos dejan de valer y este archivo se edita en el MISMO commit que cambia la regla, con el motivo: un cambio de
 * comportamiento del RBAC nunca entra en silencio.
 */
const hacerGerente = (usuarioId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

async function claveDelRolEn(usuarioId: string, sucursalId: string) {
  return (await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId, sucursalId } }, include: { rol: true } })).rol.clave;
}

async function celda(rolId: string, accionClave: string) {
  const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId, accionClave } } });
  return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : { puedeVer: false, puedeEditar: false };
}

describe("caracterización de los supuestos del RBAC (lo que se puede HOY; F3 y D13/D14 lo editan a propósito)", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
  });
  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  it("(a) un admin crea una sucursal y se nombra a sí mismo primer admin, o nombra a otro miembro de la empresa", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const miembro = await crearUsuarioConMembresia({ email: "miembro@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await actuarComo(admin);

    const aSiMismo = await crearSucursalConAdmin({ nombre: "Norte", emailPrimerAdmin: admin.email });
    expect(aSiMismo).toEqual({ ok: true, mensaje: 'Sucursal "Norte" creada, con "admin@test.com" como primer admin.' });
    const norte = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Norte" } });
    expect(await claveDelRolEn(admin.id, norte.id)).toBe("admin");

    const aOtro = await crearSucursalConAdmin({ nombre: "Sur", emailPrimerAdmin: miembro.email });
    expect(aOtro).toEqual({ ok: true, mensaje: 'Sucursal "Sur" creada, con "miembro@test.com" como primer admin.' });
    const sur = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Sur" } });
    expect(await claveDelRolEn(miembro.id, sur.id)).toBe("admin");
  });

  it("(b) un admin se baja a sí mismo a operador si queda otro admin; siendo el único, las invariantes lo frenan", async () => {
    const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(a);

    const solo = await agregarOActualizarUsuario({ email: a.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(solo.ok).toBe(false);
    expect(solo.mensaje).toMatch(/admin activo/);
    expect(await claveDelRolEn(a.id, base.sucursal.id)).toBe("admin");

    await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const conOtro = await agregarOActualizarUsuario({ email: a.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(conOtro.ok, conOtro.mensaje).toBe(true);
    expect(await claveDelRolEn(a.id, base.sucursal.id)).toBe("operador");
  });

  it("(b) un operador no se sube a sí mismo a admin: no tiene `gestion_usuarios`, y nada cambia", async () => {
    await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await actuarComo(operador);

    const r = await agregarOActualizarUsuario({ email: operador.email, sucursalId: base.sucursal.id, rolId: base.admin.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/gestion_usuarios/);
    expect(await claveDelRolEn(operador.id, base.sucursal.id)).toBe("operador");
  });

  it("(c) HOY un admin que no es el gerente edita la matriz del rol admin (una celda no fija) y le recorta la acción al gerente — D13/D14 lo cambia", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    expect((await requierePermisoDeEmpresa(gerente.id, EMPRESA_POR_DEFECTO_ID, "alta_sucursal", prisma)).ok).toBe(true);
    await actuarComo(admin);

    const anterior = await celda(base.admin.id, "alta_sucursal");
    expect(anterior).toEqual({ puedeVer: true, puedeEditar: true });
    const r = await guardarPermisos([{ rolId: base.admin.id, accionClave: "alta_sucursal", anterior, nuevo: { puedeVer: false, puedeEditar: false } }]);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await celda(base.admin.id, "alta_sucursal")).toEqual({ puedeVer: false, puedeEditar: false });
    expect((await requierePermisoDeEmpresa(gerente.id, EMPRESA_POR_DEFECTO_ID, "alta_sucursal", prisma)).ok).toBe(false);
  });

  it("(d) el piso sale del catálogo en código (la tabla Accion no lo guarda) y de la clave del rol, que renombrar no cambia", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);

    // Lo único que la base sabe de una acción es su clave y su descripción: el piso no puede cambiar dentro de una transacción.
    expect(Object.keys(await prisma.accion.findUniqueOrThrow({ where: { clave: "anular_venta" } })).sort()).toEqual(["clave", "descripcion"]);
    expect(nivelMinimoDeAccion("anular_venta")).toBe("administrador");

    // Renombrar los dos roles de sistema no les toca la clave, y el piso sigue decidiendo por ella.
    expect((await renombrarRol(base.admin.id, "jefatura")).ok).toBe(true);
    expect((await renombrarRol(base.operador.id, "caja")).ok).toBe(true);
    const roles = await prismaAdmin.rol.findMany({ where: { id: { in: [base.admin.id, base.operador.id] } }, orderBy: { nombre: "asc" } });
    expect(roles.map((r) => [r.nombre, r.clave])).toEqual([["caja", "operador"], ["jefatura", "admin"]]);

    const alAdmin = await guardarPermisos([{ rolId: base.admin.id, accionClave: "anular_venta", anterior: await celda(base.admin.id, "anular_venta"), nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(alAdmin.ok, alAdmin.mensaje).toBe(true);
    const alOperador = await guardarPermisos([{ rolId: base.operador.id, accionClave: "anular_venta", anterior: await celda(base.operador.id, "anular_venta"), nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(alOperador).toEqual({ ok: false, mensaje: 'El rol «caja» (nivel operario) no puede tener "anular_venta": es una acción de nivel administrador. No se guardó nada.' });
  });
});
