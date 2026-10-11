import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { activarTodosLosModulos, fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { __limpiarCookiesDeTest, __setCookieDeTestParaEmpresa, __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { obtenerContextoUsuario } from "../../src/server/sesion/contexto";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoEnAlgunaSucursal } from "../../src/server/acceso/gate";
import { modulosQueIncluyen } from "../../src/core/modulos/clausura";

/**
 * P20 (D23 del dueño, 2026-10-11): `obtenerMiNivelPermisoEnAlgunaSucursal` mira una acción DE SUCURSAL en TODAS las membresías vigentes del usuario en la empresa activa: alcanza con que
 * la tenga en UNA (`some`), y el resultado no depende de la sucursal activa. Es `obtenerMiNivelPermiso` (el gate de siempre) por membresía: cada sucursal pasa por la membresía vigente, el
 * módulo de la empresa, la capacidad y el piso del rol. Lo usa solo `pagar_consignante` (el costo de consignación del producto, que es de la empresa).
 *
 * Qué se prueba, con el contexto REAL (`obtenerContextoUsuario`, cuyas `membresias` ya son las activas, de sucursales activas, de la empresa activa):
 *  - admin en Central y operador en Norte: ver y editar desde las dos sucursales activas (mutación: `some` → `every`, o volver a la sucursal activa, pone en rojo el caso de Norte);
 *  - operador en las dos: ni ver ni editar, desde ninguna;
 *  - FALLO CERRADO: la membresía de admin inactiva, la sucursal de admin inactiva, el rol de admin inactivo y el módulo `consignacion` apagado no cuentan; sin membresías, ni ver ni editar;
 *  - AISLAMIENTO ENTRE EMPRESAS: ser admin en una sucursal de OTRA empresa no abre nada en la empresa activa (y el control inverso, estando en la otra, sí).
 * Con el RBAC por clave de la matriz de fábrica: `pagar_consignante` es de piso administrador, así que un rol de operario nunca la tiene aunque tenga la fila.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const CLAVE = "pagar_consignante" as const;

let centralId: string;
let norteId: string;
let rolAdminId: string;
let rolOperadorId: string;
let n = 0;

/** Un usuario con sus membresías (sucursal, rol): la primera es la más antigua, que es la activa si no se elige otra. */
async function usuario(membresias: { sucursalId: string; rolId: string; activo?: boolean }[]) {
  const email = `u${++n}@test.com`;
  const [primera, ...resto] = membresias;
  const u = await crearUsuarioConMembresia({ email, ...primera });
  for (const m of resto) await crearMembresia({ usuarioId: u.id, ...m });
  return { id: u.id, email };
}

/** El contexto real del usuario, parado en `sucursalActivaId` (o en su sucursal más antigua si no se pasa). */
async function ctxDe(u: { id: string; email: string }, sucursalActivaId?: string) {
  await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
  __setCookieDeTestParaSucursal(sucursalActivaId);
  const ctx = await obtenerContextoUsuario();
  expect(ctx, "el usuario tiene contexto").not.toBeNull();
  return ctx!;
}

const nivel = async (u: { id: string; email: string }, sucursalActivaId?: string) => obtenerMiNivelPermisoEnAlgunaSucursal(await ctxDe(u, sucursalActivaId), CLAVE);

const SI = { ver: true, editar: true };
const NO = { ver: false, editar: false };

beforeEach(async () => {
  await limpiarBaseDeTest();
  __limpiarCookiesDeTest();
  const base = await sembrarBase();
  centralId = base.sucursal.id;
  norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
  rolAdminId = base.admin.id;
  rolOperadorId = base.operador.id;
});

afterEach(() => __limpiarCookiesDeTest());

describe("P20: pagar_consignante se evalúa en toda la empresa", () => {
  it("admin en Central y operador en Norte: ve y edita estando parado en Norte (donde es operador) y estando parado en Central", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolAdminId },
      { sucursalId: norteId, rolId: rolOperadorId },
    ]);
    expect(await nivel(u, norteId)).toEqual(SI);
    expect(await nivel(u, centralId)).toEqual(SI);
    expect(await nivel(u)).toEqual(SI);
  });

  it("al revés (operador en Central, admin en Norte) da lo mismo: no depende del orden de las membresías", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolAdminId },
    ]);
    expect(await nivel(u, centralId)).toEqual(SI);
    expect(await nivel(u, norteId)).toEqual(SI);
  });

  it("el mismo usuario, por el gate de UNA sola sucursal, sigue viendo lo de siempre (la función nueva no cambió el gate): operador en Norte no tiene la clave allí", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolAdminId },
      { sucursalId: norteId, rolId: rolOperadorId },
    ]);
    expect(await obtenerMiNivelPermiso(u.id, norteId, CLAVE, prisma)).toEqual(NO);
    expect(await obtenerMiNivelPermiso(u.id, centralId, CLAVE, prisma)).toEqual(SI);
  });

  it("RECHAZO: un operador en las dos sucursales no ve ni edita, desde ninguna", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolOperadorId },
    ]);
    expect(await nivel(u, centralId)).toEqual(NO);
    expect(await nivel(u, norteId)).toEqual(NO);
  });

  it("FALLO CERRADO: sin membresías en el contexto, ni ver ni editar (y no consulta nada)", async () => {
    const u = await usuario([{ sucursalId: centralId, rolId: rolAdminId }]);
    const ctx = await ctxDe(u);
    expect(await obtenerMiNivelPermisoEnAlgunaSucursal({ ...ctx, membresias: [] }, CLAVE)).toEqual(NO);
  });

  it("FALLO CERRADO: la membresía de admin INACTIVA no cuenta (el contexto no la trae)", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolAdminId, activo: false },
    ]);
    expect((await ctxDe(u)).membresias.map((m) => m.sucursalId)).toEqual([centralId]);
    expect(await nivel(u, centralId)).toEqual(NO);
  });

  it("FALLO CERRADO: la membresía inactiva tampoco cuenta si se la pasa a mano: el gate de cada sucursal la descarta", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolAdminId, activo: false },
    ]);
    const ctx = await ctxDe(u);
    expect(await obtenerMiNivelPermisoEnAlgunaSucursal({ ...ctx, membresias: [{ sucursalId: centralId }, { sucursalId: norteId }] }, CLAVE)).toEqual(NO);
  });

  it("FALLO CERRADO: la SUCURSAL de admin inactiva no cuenta", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolAdminId },
    ]);
    expect(await nivel(u, centralId)).toEqual(SI);
    await prismaAdmin.sucursal.update({ where: { id: norteId }, data: { activo: false } });
    expect((await ctxDe(u)).membresias.map((m) => m.sucursalId)).toEqual([centralId]);
    expect(await nivel(u, centralId)).toEqual(NO);
  });

  it("FALLO CERRADO: el ROL de admin inactivo no cuenta (el gate de la sucursal lo descarta aunque la membresía esté activa)", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolOperadorId },
      { sucursalId: norteId, rolId: rolAdminId },
    ]);
    expect(await nivel(u, centralId)).toEqual(SI);
    await prismaAdmin.rol.update({ where: { id: rolAdminId }, data: { activo: false } });
    expect(await nivel(u, centralId)).toEqual(NO);
  });

  it("FALLO CERRADO: con el módulo Consignación apagado no se ve ni se edita, aunque sea admin en las dos", async () => {
    const u = await usuario([
      { sucursalId: centralId, rolId: rolAdminId },
      { sucursalId: norteId, rolId: rolAdminId },
    ]);
    expect(await nivel(u, norteId)).toEqual(SI);
    await fijarModulosActivos(
      E,
      MODULOS_VENDIBLES.filter((v) => modulosQueIncluyen("consignacion", [v]).length === 0),
    );
    expect(await nivel(u, norteId)).toEqual(NO);
    expect(await nivel(u, centralId)).toEqual(NO);
    await activarTodosLosModulos(E);
    expect(await nivel(u, norteId)).toEqual(SI);
  });

  describe("aislamiento entre empresas", () => {
    /** La empresa «norte» con su sucursal y su rol admin, que tiene la fila de `pagar_consignante` (como la matriz de fábrica). */
    async function empresaNorte() {
      await prismaAdmin.empresa.create({ data: { id: "norte", nombre: "Empresa norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      await activarTodosLosModulos("norte");
      const sucursal = await prismaAdmin.sucursal.create({ data: { nombre: "Sucursal norte", empresaId: "norte" } });
      const rolAdmin = await prismaAdmin.rol.create({ data: { nombre: "admin", clave: "admin", empresaId: "norte" } });
      await prismaAdmin.permisoRol.create({ data: { empresaId: "norte", rolId: rolAdmin.id, accionClave: CLAVE, puedeVer: true, puedeEditar: true } });
      return { sucursalId: sucursal.id, rolAdminId: rolAdmin.id };
    }

    it("admin en una sucursal de OTRA empresa y operador en la activa: en la activa no ve ni edita; parado en la otra empresa, sí (control)", async () => {
      const otra = await empresaNorte();
      const u = await usuario([
        { sucursalId: centralId, rolId: rolOperadorId },
        { sucursalId: otra.sucursalId, rolId: otra.rolAdminId },
      ]);
      __setCookieDeTestParaEmpresa(E);
      const ctxA = await ctxDe(u);
      expect(ctxA.empresaId).toBe(E);
      expect(ctxA.membresias.map((m) => m.sucursalId)).toEqual([centralId]);
      expect(await obtenerMiNivelPermisoEnAlgunaSucursal(ctxA, CLAVE)).toEqual(NO);

      __setCookieDeTestParaEmpresa("norte");
      const ctxB = await ctxDe(u);
      expect(ctxB.empresaId).toBe("norte");
      expect(ctxB.membresias.map((m) => m.sucursalId)).toEqual([otra.sucursalId]);
      expect(await obtenerMiNivelPermisoEnAlgunaSucursal(ctxB, CLAVE)).toEqual(SI);
    });

    it("el contexto de la empresa activa nunca trae membresías de la otra: ni siquiera sirve pasarle la sucursal ajena a mano con la base de la activa", async () => {
      const otra = await empresaNorte();
      const u = await usuario([
        { sucursalId: centralId, rolId: rolOperadorId },
        { sucursalId: otra.sucursalId, rolId: otra.rolAdminId },
      ]);
      __setCookieDeTestParaEmpresa(E);
      const ctxA = await ctxDe(u);
      // El RLS de empresa: con la base de la activa, la membresía de la otra empresa no se lee, así que no hay membresía vigente.
      expect(await obtenerMiNivelPermisoEnAlgunaSucursal({ ...ctxA, membresias: [{ sucursalId: centralId }, { sucursalId: otra.sucursalId }] }, CLAVE)).toEqual(NO);
    });
  });
});
