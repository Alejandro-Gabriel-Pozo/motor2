import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin } from "../setup/test-db";
import { activarTodosLosModulos } from "../setup/modulos";
import { crearMembresia } from "../setup/membresia";
import {
  accionesDelMenuQueElUsuarioPuedeVer,
  requierePermisoDeEmpresa,
  requierePermisoVerDeEmpresa,
} from "../../src/server/acceso/gate";

/**
 * Gate de las acciones de CONTEXTO EMPRESA: el permiso vale si CUALQUIER membresía activa del usuario en la empresa lo tiene, no solo la de
 * la sucursal en la que está parado. Va con `prismaAdmin` (sin RLS) porque los casos arman una segunda empresa.
 */
describe("gate de permisos — acciones de empresa", () => {
  let empresaId: string;
  let sucursalA: string;
  let sucursalB: string;
  let rolAdminId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    empresaId = base.sucursal.empresaId;
    sucursalA = base.sucursal.id;
    sucursalB = (await prismaAdmin.sucursal.create({ data: { nombre: "Segunda", empresaId } })).id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
  });

  it("el permiso de otra sucursal de la MISMA empresa vale (operador en A, admin en B)", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "mixto@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: rolAdminId });

    expect((await requierePermisoDeEmpresa(usuario.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(true);
    expect((await requierePermisoVerDeEmpresa(usuario.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(true);
  });

  it("un operador sin ninguna membresía admin sigue denegado en una acción de empresa solo de admin", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: rolOperadorId });

    const editar = await requierePermisoDeEmpresa(usuario.id, empresaId, "gestion_permisos", prismaAdmin);
    const ver = await requierePermisoVerDeEmpresa(usuario.id, empresaId, "gestion_permisos", prismaAdmin);
    expect(editar.ok).toBe(false);
    expect(ver.ok).toBe(false);
  });

  it("una acción abierta al operador (alta_producto) la tiene cualquier membresía", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "operador2@test.com", sucursalId: sucursalB, rolId: rolOperadorId });
    expect((await requierePermisoDeEmpresa(usuario.id, empresaId, "alta_producto", prismaAdmin)).ok).toBe(true);
  });

  it("la membresía con el permiso inactiva, o con el rol desactivado, o en una sucursal desactivada, no cuenta", async () => {
    const inactiva = await crearUsuarioConMembresia({ email: "inactiva@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: inactiva.id, sucursalId: sucursalB, rolId: rolAdminId, activo: false });
    expect((await requierePermisoDeEmpresa(inactiva.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(false);

    const sinSucursal = await crearUsuarioConMembresia({ email: "sucursal-off@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: sinSucursal.id, sucursalId: sucursalB, rolId: rolAdminId });
    await prismaAdmin.sucursal.update({ where: { id: sucursalB }, data: { activo: false } });
    expect((await requierePermisoDeEmpresa(sinSucursal.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(false);
    await prismaAdmin.sucursal.update({ where: { id: sucursalB }, data: { activo: true } });

    const rolOff = await crearUsuarioConMembresia({ email: "rol-off@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: rolOff.id, sucursalId: sucursalB, rolId: rolAdminId });
    await prismaAdmin.rol.update({ where: { id: rolAdminId }, data: { activo: false } });
    expect((await requierePermisoDeEmpresa(rolOff.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(false);
  });

  it("sin ninguna membresía en la empresa: «no tenés acceso a esta empresa»", async () => {
    const usuario = await prismaAdmin.user.create({ data: { email: "sin-membresia@test.com" } });
    const r = await requierePermisoDeEmpresa(usuario.id, empresaId, "alta_producto", prismaAdmin);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensaje).toMatch(/No tenés acceso a esta empresa/);
      expect([r.motivo, "caso" in r ? r.caso : null]).toEqual(["SIN_PERMISO", "SIN_ACCESO_A_EMPRESA"]);
    }
  });

  it("la Central deshabilita la acción en la sucursal que la daba: se niega, y avisa que fue la Central", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: rolAdminId });
    await prismaAdmin.capacidadSucursal.create({ data: { accionClave: "unidades", sucursalId: sucursalA, habilitado: false } });

    const r = await requierePermisoDeEmpresa(admin.id, empresaId, "unidades", prismaAdmin);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensaje).toMatch(/La Central no habilitó/);
      expect(r.motivo).toBe("SIN_CAPACIDAD");
    }
  });

  it("la capacidad deshabilitada en UNA sucursal no bloquea si otra membresía sí la tiene habilitada", async () => {
    const admin = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: sucursalA, rolId: rolAdminId });
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursalB, rolId: rolAdminId });
    await prismaAdmin.capacidadSucursal.create({ data: { accionClave: "unidades", sucursalId: sucursalA, habilitado: false } });

    expect((await requierePermisoDeEmpresa(admin.id, empresaId, "unidades", prismaAdmin)).ok).toBe(true);
  });

  it("un admin de OTRA empresa no tiene la acción en esta (y sí en la suya)", async () => {
    await prismaAdmin.empresa.create({
      data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
    });
    await activarTodosLosModulos("norte");
    const sucursalNorte = await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } });
    const rolNorte = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: "norte" } });
    await prismaAdmin.permisoRol.create({
      data: { rolId: rolNorte.id, accionClave: "gestion_permisos", puedeVer: true, puedeEditar: true, empresaId: "norte" },
    });
    const ajeno = await crearUsuarioConMembresia({ email: "ajeno@test.com", sucursalId: sucursalNorte.id, rolId: rolNorte.id });

    expect((await requierePermisoDeEmpresa(ajeno.id, empresaId, "gestion_permisos", prismaAdmin)).ok).toBe(false);
    expect((await requierePermisoDeEmpresa(ajeno.id, "norte", "gestion_permisos", prismaAdmin)).ok).toBe(true);
  });
});

describe("menú — acciones de sucursal y de empresa combinadas", () => {
  let empresaId: string;
  let sucursalA: string;
  let sucursalB: string;
  let rolAdminId: string;
  let rolOperadorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    empresaId = base.sucursal.empresaId;
    sucursalA = base.sucursal.id;
    sucursalB = (await prismaAdmin.sucursal.create({ data: { nombre: "Segunda", empresaId } })).id;
    rolAdminId = base.admin.id;
    rolOperadorId = base.operador.id;
  });

  const CLAVES = ["alta_producto", "gestion_permisos", "ver_stock", "precio_local"] as const;

  it("las de empresa se ven si alguna membresía las da; las de sucursal, solo en la sucursal activa", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "menu@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursalB, rolId: rolAdminId });

    const parado_en_A = await accionesDelMenuQueElUsuarioPuedeVer(usuario.id, empresaId, sucursalA, CLAVES, prismaAdmin);
    expect([...parado_en_A].sort()).toEqual(["alta_producto", "gestion_permisos", "ver_stock"]);

    const parado_en_B = await accionesDelMenuQueElUsuarioPuedeVer(usuario.id, empresaId, sucursalB, CLAVES, prismaAdmin);
    expect([...parado_en_B].sort()).toEqual(["alta_producto", "gestion_permisos", "precio_local", "ver_stock"]);
  });

  it("un operador solo ve lo abierto al operador, de los dos contextos", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "menu2@test.com", sucursalId: sucursalA, rolId: rolOperadorId });
    const visibles = await accionesDelMenuQueElUsuarioPuedeVer(usuario.id, empresaId, sucursalA, CLAVES, prismaAdmin);
    expect([...visibles].sort()).toEqual(["alta_producto", "ver_stock"]);
  });

  it("sin acciones de empresa en la lista no consulta la empresa (lista vacía → vacío)", async () => {
    const usuario = await crearUsuarioConMembresia({ email: "menu3@test.com", sucursalId: sucursalA, rolId: rolAdminId });
    expect((await accionesDelMenuQueElUsuarioPuedeVer(usuario.id, empresaId, sucursalA, [], prismaAdmin)).size).toBe(0);
  });
});
