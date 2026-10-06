import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { agregarOActualizarUsuario, actualizarActivoMembresia, actualizarNotasMembresia } from "../../src/server/actions/auth/usuarios";
import { conGobierno } from "../../src/server/actions/con-gobierno";
import { conInvariantesDeGobierno, contarAdminsEfectivos } from "../../src/core/permisos/invariantes";
import { ok } from "../../src/server/actions/tipos";

/**
 * Bloque G, G2: las salvaguardas de la gestión de usuarios se miden sobre el ESTADO que de verdad deja entrar (admin efectivo), dentro de una
 * transacción serializable, y por la CLAVE del rol. Cada caso es uno que pasaba con la lógica anterior (por nombre, leyendo fuera de la transacción)
 * y ahora se rechaza.
 */

const hacerGerente = (usuarioId: string) =>
  prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });

const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

async function rolDe(usuarioId: string, sucursalId: string) {
  return (await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId, sucursalId } }, include: { rol: true } })).rol.clave;
}

describe("G2: gestión de usuarios", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });
  afterEach(() => {
    __setCookieDeTestParaSucursal(undefined);
  });

  it("D1: un admin con la cuenta apagada en toda la plataforma no cuenta como admin: el único que puede entrar no se baja a operador", async () => {
    const base = await sembrarBase();
    const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.user.update({ where: { id: b.id }, data: { activoGlobal: false } });
    await actuarComo(a);

    const r = await agregarOActualizarUsuario({ email: a.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/admin activo/);
    expect(await rolDe(a.id, base.sucursal.id)).toBe("admin");
  });

  it("D1 (control): con otro admin que sí puede entrar, el cambio se aplica", async () => {
    const base = await sembrarBase();
    const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await actuarComo(a);

    const r = await agregarOActualizarUsuario({ email: a.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await rolDe(a.id, base.sucursal.id)).toBe("operador");
  });

  it("D2: dos admins que se desactivan el uno al otro a la vez no pueden aplicarse los dos: queda uno", async () => {
    const base = await sembrarBase();
    const a = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const b = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const membresia = (usuarioId: string) => prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId, sucursalId: base.sucursal.id } } });
    const [ma, mb] = [await membresia(a.id), await membresia(b.id)];
    const ctx = { transaccion: ((fn, opciones) => prismaAdmin.$transaction(fn, opciones)) as Parameters<typeof conGobierno>[0]["transaccion"] };
    const apagar = (id: string) =>
      conGobierno(ctx, (tx) => conInvariantesDeGobierno(tx, EMPRESA_POR_DEFECTO_ID, async () => {
        await tx.usuarioSucursal.update({ where: { id }, data: { activo: false } });
        return ok("apagado");
      }));

    const resultados = await Promise.all([apagar(mb.id), apagar(ma.id)]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await contarAdminsEfectivos(prismaAdmin, EMPRESA_POR_DEFECTO_ID)).toBe(1);
  });

  it("D3: el gerente con otra membresía activa pero en una sucursal apagada no puede desactivar su única sucursal activa", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "otro-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    const apagada = await prisma.sucursal.create({ data: { nombre: "Apagada", activo: false } });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: apagada.id, rolId: base.operador.id });
    const miMembresia = await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId: gerente.id, sucursalId: base.sucursal.id } } });
    await actuarComo(gerente);

    const r = await actualizarActivoMembresia(miMembresia.id, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/traspas/);
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: miMembresia.id } })).activo).toBe(true);
  });

  it("D6: un admin que no es el gerente no edita las notas del gerente; las de un operador sí", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "op@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await hacerGerente(gerente.id);
    const idDe = async (usuarioId: string) => (await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId, sucursalId: base.sucursal.id } } })).id;
    await actuarComo(admin);

    const alGerente = await actualizarNotasMembresia(await idDe(gerente.id), "mía ahora");
    expect(alGerente.ok).toBe(false);
    expect(alGerente.mensaje).toMatch(/gerente/);
    expect((await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { id: await idDe(gerente.id) } })).notas).not.toBe("mía ahora");

    const alOperador = await actualizarNotasMembresia(await idDe(operador.id), "nota");
    expect(alOperador.ok, alOperador.mensaje).toBe(true);
  });

  it("Q1: el gerente que es admin solo en una sucursal no se baja a operador sin traspasar antes", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearUsuarioConMembresia({ email: "otro-admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: norte.id, rolId: base.operador.id });
    __setCookieDeTestParaSucursal(base.sucursal.id);
    await actuarComo(gerente);

    const r = await agregarOActualizarUsuario({ email: gerente.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/traspas/);
    expect(await rolDe(gerente.id, base.sucursal.id)).toBe("admin");
  });

  it("Q1 (control): si el gerente es admin efectivo en otra sucursal activa, se baja a operador en esta", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await crearMembresia({ usuarioId: gerente.id, sucursalId: norte.id, rolId: base.admin.id });
    __setCookieDeTestParaSucursal(base.sucursal.id);
    await actuarComo(gerente);

    const r = await agregarOActualizarUsuario({ email: gerente.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect(r.ok, r.mensaje).toBe(true);
    expect(await rolDe(gerente.id, base.sucursal.id)).toBe("operador");
  });

  it("L1: un alta rechazada no deja creado el usuario (el User se crea dentro de la transacción, después de validar)", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const inactivo = await prisma.rol.create({ data: { nombre: "viejo", activo: false } });
    await actuarComo(admin);

    const r = await agregarOActualizarUsuario({ email: "nuevo@test.com", sucursalId: base.sucursal.id, rolId: inactivo.id });
    expect(r.ok).toBe(false);
    expect(await prismaAdmin.user.findUnique({ where: { email: "nuevo@test.com" } })).toBeNull();
  });

  it("techo: un admin que no es el gerente no puede modificar al gerente por ninguna de las dos vías", async () => {
    const base = await sembrarBase();
    const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await hacerGerente(gerente.id);
    const suya = await prismaAdmin.usuarioSucursal.findUniqueOrThrow({ where: { usuarioId_sucursalId: { usuarioId: gerente.id, sucursalId: base.sucursal.id } } });
    await actuarComo(admin);

    const porRol = await agregarOActualizarUsuario({ email: gerente.email, sucursalId: base.sucursal.id, rolId: base.operador.id });
    const porActivo = await actualizarActivoMembresia(suya.id, false);
    expect(porRol.ok).toBe(false);
    expect(porRol.mensaje).toMatch(/gerente/);
    expect(porActivo.ok).toBe(false);
    expect(porActivo.mensaje).toMatch(/gerente/);
    expect(await rolDe(gerente.id, base.sucursal.id)).toBe("admin");
  });
});
