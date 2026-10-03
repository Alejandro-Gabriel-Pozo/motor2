import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { crearRol, renombrarRol, actualizarActivoRol } from "../../src/server/actions/permisos/roles";
import { listarRegistrosAuditoria } from "../../src/core/permisos/auditoria";
import { esRolAdmin } from "../../src/core/permisos/jerarquia";
import { mensajeSiNombreDeRolNoPermitido, normalizarNombreDeRol } from "../../src/core/permisos/nombres-de-rol";

/**
 * Bloque G, G3: renombrar un rol cambia la etiqueta, nunca la identidad. El rol «admin» renombrado sigue siendo el administrador (la clave manda),
 * los nombres de fábrica están reservados a quien tiene esa clave, y el cambio queda auditado.
 */

const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

describe("G3: nombres de rol (regla pura)", () => {
  it("normaliza: recorta, minúscula y junta los espacios repetidos", () => {
    expect(normalizarNombreDeRol("  Jefe   de  Sala ")).toBe("jefe de sala");
  });

  it("los nombres de fábrica son del rol con esa clave; «gerente» no es de ningún rol", () => {
    expect(mensajeSiNombreDeRolNoPermitido("admin", "admin")).toBeNull();
    expect(mensajeSiNombreDeRolNoPermitido("administrador", "admin")).toBeNull();
    expect(mensajeSiNombreDeRolNoPermitido("operario", "operador")).toBeNull();
    expect(mensajeSiNombreDeRolNoPermitido("admin", "operador")).toMatch(/reservado/);
    expect(mensajeSiNombreDeRolNoPermitido("operador", null)).toMatch(/reservado/);
    expect(mensajeSiNombreDeRolNoPermitido("administrador", null)).toMatch(/reservado/);
    expect(mensajeSiNombreDeRolNoPermitido("gerente", null)).toMatch(/reservado/);
    expect(mensajeSiNombreDeRolNoPermitido("gerente", "admin")).toMatch(/reservado/);
    expect(mensajeSiNombreDeRolNoPermitido("jefe", null)).toBeNull();
  });

  it("vacío y charset inválido se rechazan; el largo máximo es el del catálogo", () => {
    expect(mensajeSiNombreDeRolNoPermitido("", null)).toMatch(/vacío/);
    expect(mensajeSiNombreDeRolNoPermitido("a<b", null)).toMatch(/caracteres no permitidos/);
    expect(mensajeSiNombreDeRolNoPermitido("x".repeat(81), null)).toMatch(/80/);
    expect(mensajeSiNombreDeRolNoPermitido("x".repeat(80), null)).toBeNull();
  });
});

describe("G3: renombrarRol", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });
  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  it("el rol «admin» renombrado conserva su clave, su permiso y su carácter de administrador", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);

    const r = await renombrarRol(base.admin.id, "  Jefatura  ");
    expect(r.ok, r.mensaje).toBe(true);

    const rol = await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.admin.id } });
    expect(rol.nombre).toBe("jefatura");
    expect(rol.clave).toBe("admin");
    expect(esRolAdmin(rol)).toBe(true);

    // Sigue gobernando: con el nombre nuevo, puede volver a renombrar (el permiso va por la clave y la matriz, no por el nombre).
    const otra = await renombrarRol(base.admin.id, "administrador");
    expect(otra.ok, otra.mensaje).toBe(true);
  });

  it("deja el rastro en la auditoría con el nombre anterior y el nuevo", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);

    expect((await renombrarRol(base.operador.id, "encargado")).ok).toBe(true);

    const { items } = await listarRegistrosAuditoria({ entidad: "Rol", incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id] }, prisma);
    const registro = items.find((i) => i.entidadId === base.operador.id && i.campo === "nombre");
    expect(registro?.valorAnterior).toBe("operador");
    expect(registro?.valorNuevo).toBe("encargado");
    expect(registro?.actor.email).toBe("admin@test.com");
  });

  it("no pisa el nombre de otro rol", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);
    expect((await crearRol("cajero")).ok).toBe(true);

    const r = await renombrarRol(base.operador.id, "Cajero");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Ya existe/);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.operador.id } })).nombre).toBe("operador");
  });

  it("un rol creado a mano no puede tomar un nombre de fábrica, ni siquiera el que dejó libre el rol de sistema", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);
    expect((await renombrarRol(base.operador.id, "encargado")).ok).toBe(true);

    expect((await crearRol("operador")).ok).toBe(false);
    expect((await crearRol("Operario")).ok).toBe(false);
    expect((await crearRol("gerente")).ok).toBe(false);
    expect((await crearRol("administrador")).ok).toBe(false);
    expect((await crearRol("cajero")).ok).toBe(true);
    const cajero = await prismaAdmin.rol.findFirstOrThrow({ where: { nombre: "cajero" } });
    const r = await renombrarRol(cajero.id, "admin");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/reservado/);
  });

  it("el rol de sistema puede volver a su nombre de fábrica; el operador recibe también «operario»", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);

    expect((await renombrarRol(base.operador.id, "operario")).ok).toBe(true);
    expect((await renombrarRol(base.operador.id, "operador")).ok).toBe(true);
    expect((await renombrarRol(base.operador.id, "admin")).ok).toBe(false);
  });

  it("quien solo es operario no puede renombrar: el piso de la acción es administrador, aunque la matriz le diera el permiso", async () => {
    const base = await sembrarBase();
    const operario = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prismaAdmin.permisoRol.updateMany({ where: { rolId: base.operador.id, accionClave: "renombrar_rol" }, data: { puedeVer: true, puedeEditar: true } });
    await actuarComo(operario);

    const r = await renombrarRol(base.operador.id, "otro");
    expect(r.ok).toBe(false);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.operador.id } })).nombre).toBe("operador");
  });

  it("un rol inexistente o el mismo nombre no rompen nada", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);

    expect((await renombrarRol("no-existe", "algo")).ok).toBe(false);
    const igual = await renombrarRol(base.operador.id, "OPERADOR");
    expect(igual.ok).toBe(true);
    const { items } = await listarRegistrosAuditoria({ entidad: "Rol", incluirFilasDeEmpresa: true, sucursalIds: [base.sucursal.id] }, prisma);
    expect(items.filter((i) => i.campo === "nombre")).toHaveLength(0);
  });

  it("desactivar sigue protegido por clave aunque el rol de sistema tenga otro nombre", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(admin);
    expect((await renombrarRol(base.admin.id, "jefatura")).ok).toBe(true);

    const r = await actualizarActivoRol(base.admin.id, false);
    expect(r.ok).toBe(false);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: base.admin.id } })).activo).toBe(true);
  });
});
