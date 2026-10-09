import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearSucursalConAdminCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/crear-sucursal-con-admin";
import { crearSucursalConAdmin } from "../../src/server/actions/auth/sucursales";

/**
 * Contrato C6 del RBAC (O.35; Hito 3, I.4b de `docs/plan-hito-3-pureza.md`): el alta de una sucursal con su primer admin aplica el techo de privilegio para DAR
 * el rol admin (`mensajeSiNoPuedeAsignarRol`), y NO el techo de gestión sobre el nombrado (`mensajeSiNoPuedeGestionar`).
 *
 * Hoy el techo no rechaza a nadie: `alta_sucursal` tiene piso administrador y solo el rol `admin` lo alcanza, así que por la acción no se puede llegar con
 * alguien que no sea administrador. Por eso el rechazo se prueba «A' simulado» (la Alternativa A' de la evaluación del RBAC: un rol de rango intermedio que
 * llegara a tener `alta_sucursal`): se llama al CASO DE USO directo, con un actor que ya «pasó» el permiso pero no es administrador en ninguna sucursal ni
 * gerente. Sin el techo, ese actor podría crearse una sucursal y nombrar a cualquiera (o a sí mismo) administrador, y como las acciones de empresa valen con
 * cualquier membresía, pasaría a tener todo el gobierno. La otra mitad del contrato va por la acción real: un administrador que no es gerente nombra al
 * gerente primer admin (el techo de gestión, si se aplicara al nombrado, lo impediría: «Solo el gerente de la empresa puede modificar al gerente»).
 */
const MENSAJE_TECHO_DE_ADMIN = "Solo un administrador o el gerente de la empresa puede dar el rol de administrador o modificar a un administrador.";

const hacerGerente = (usuarioId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

describe("C6: techo de privilegio en el alta de sucursal", () => {
  let centralId: string;
  let operadorRolId: string;
  let adminRolId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    operadorRolId = base.operador.id;
    adminRolId = base.admin.id;
  });

  /** Un actor que «pasó» el permiso de `alta_sucursal` (A' simulado): miembro de Central, administrador ahí solo si `esAdmin`. */
  const actor = (usuarioId: string, esAdmin: boolean) => ({
    usuarioId,
    empresaId: EMPRESA_POR_DEFECTO_ID,
    rolEmpresa: null,
    membresias: [{ sucursalId: centralId, sucursalNombre: "Central", rolNombre: esAdmin ? "admin" : "encargado", esAdmin }],
    ...baseDeTest,
  });

  const foto = async () => ({
    sucursales: await prismaAdmin.sucursal.count(),
    membresias: await prismaAdmin.usuarioSucursal.count(),
    auditoria: await prismaAdmin.registroAuditoria.count(),
  });

  it("A' simulado: quien no es administrador ni gerente no puede dar el rol admin al crear una sucursal (ni a otro ni a sí mismo); no se escribe nada", async () => {
    const encargado = await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId: centralId, rolId: operadorRolId });
    await crearUsuarioConMembresia({ email: "nombrado@test.com", sucursalId: centralId, rolId: operadorRolId });
    const antes = await foto();

    for (const email of ["nombrado@test.com", "encargado@test.com"]) {
      const r = await crearSucursalConAdminCasoDeUso(actor(encargado.id, false), { nombre: "Norte", email });
      expect(r, email).toEqual({ ok: false, codigo: "TECHO_DE_PRIVILEGIO", mensaje: MENSAJE_TECHO_DE_ADMIN });
    }
    expect(await foto()).toEqual(antes);
  });

  it("control del A' simulado: el mismo pedido de un administrador sí crea la sucursal (el rechazo de arriba es por el techo, no por otra cosa)", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: adminRolId });
    await crearUsuarioConMembresia({ email: "nombrado@test.com", sucursalId: centralId, rolId: operadorRolId });

    const r = await crearSucursalConAdminCasoDeUso(actor(admin.id, true), { nombre: "Norte", email: "nombrado@test.com" });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await prismaAdmin.sucursal.count({ where: { nombre: "Norte" } })).toBe(1);
  });

  it("sin techo de gestión sobre el nombrado: un administrador que no es gerente nombra al gerente primer admin de la sucursal nueva (por la acción)", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: adminRolId });
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: centralId, rolId: adminRolId });
    await hacerGerente(gerente.id);
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const r = await crearSucursalConAdmin({ nombre: "Norte", emailPrimerAdmin: "gerente@test.com" });

    expect(r).toEqual({ ok: true, mensaje: 'Sucursal "Norte" creada, con "gerente@test.com" como primer admin.' });
    const norte = await prismaAdmin.sucursal.findFirstOrThrow({ where: { nombre: "Norte" } });
    const membresia = await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId: gerente.id, sucursalId: norte.id } }, include: { rol: true } });
    expect(membresia.rol.clave).toBe("admin");
  });
});
