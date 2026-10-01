import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { ACCIONES, nivelDeRol, nivelMinimoDeAccion, rolAlcanzaLaAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import {
  accionesDelMenuQueElUsuarioPuedeVer,
  accionesQueElUsuarioPuedeVer,
  obtenerMiNivelPermiso,
  obtenerMiNivelPermisoDeEmpresa,
  requierePermiso,
  requierePermisoDeEmpresa,
  requierePermisoVer,
  requierePermisoVerDeEmpresa,
} from "../../src/core/permisos/gate";
import { esCeldaFueraDeNivel, SIN_PERMISO } from "../../src/core/permisos/matriz";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";

/**
 * Jerarquía de niveles (operario < administrador < gerente): cada acción tiene un PISO (`nivelMinimo`) y ningún rol por debajo lo alcanza, por más que
 * la matriz diga otra cosa. Anti-escalada: se hace cumplir en dos puntos independientes — `guardarPermisos` rechaza el alta, y el gate ignora la
 * fila aunque exista (una migración o un dato viejo no se convierten en acceso).
 *
 * Los roles son de ejemplo: «admin» es nivel administrador; «operador» y los personalizados (acá «mozo») son nivel operario.
 */
const DE_ADMIN_SUCURSAL = "secciones"; // piso administrador, contexto sucursal
const DE_ADMIN_EMPRESA = "unidades"; // piso administrador, contexto empresa
const DE_OPERARIO_SUCURSAL = "editar_producto"; // piso operario, contexto sucursal
const DE_OPERARIO_EMPRESA = "alta_producto"; // piso operario, contexto empresa

describe("el catálogo y los niveles (puro)", () => {
  it("los ejemplos de este test son del piso y contexto que dicen ser", () => {
    expect(nivelMinimoDeAccion(DE_ADMIN_SUCURSAL)).toBe("administrador");
    expect(nivelMinimoDeAccion(DE_ADMIN_EMPRESA)).toBe("administrador");
    expect(nivelMinimoDeAccion(DE_OPERARIO_SUCURSAL)).toBe("operario");
    expect(nivelMinimoDeAccion(DE_OPERARIO_EMPRESA)).toBe("operario");
  });

  it("«admin» es administrador; «operador» y cualquier rol personalizado son operario; ningún rol es gerente", () => {
    expect(nivelDeRol("admin")).toBe("administrador");
    for (const nombre of ["operador", "mozo", "cajero", "Admin", "administrador", "gerente"]) expect(nivelDeRol(nombre), nombre).toBe("operario");
  });

  it("un rol operario alcanza solo las acciones de piso operario; «admin», las de operario y administrador; ninguno, las de gerente", () => {
    for (const a of ACCIONES) {
      const clave = a.clave as AccionClave;
      expect(rolAlcanzaLaAccion("mozo", clave), `mozo/${clave}`).toBe(a.nivelMinimo === "operario");
      expect(rolAlcanzaLaAccion("operador", clave), `operador/${clave}`).toBe(a.nivelMinimo === "operario");
      expect(rolAlcanzaLaAccion("admin", clave), `admin/${clave}`).toBe((a.nivelMinimo as NivelDeAccion) !== "gerente");
    }
  });

  it("una acción de piso gerente es de contexto empresa (no hay «gerente» por sucursal) y no la alcanza ningún rol", () => {
    // Hoy el catálogo no tiene ninguna de piso gerente: la guarda vale para la primera que se agregue.
    for (const a of ACCIONES.filter((x) => (x.nivelMinimo as NivelDeAccion) === "gerente")) {
      expect(a.contexto, a.clave).toBe("empresa");
      expect(esCeldaFueraDeNivel("admin", a.clave as AccionClave), a.clave).toBe(true);
    }
  });
});

describe("anti-escalada: un rol por debajo del piso no llega a la acción", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let mozoRolId: string;
  let mozoId: string;
  let operadorId: string;
  let adminId: string;

  /** Una fila de la matriz como la dejaría una migración vieja o un dato escrito sin pasar por `guardarPermisos`. */
  const darFila = (rolId: string, accionClave: string, puedeVer = true, puedeEditar = true) =>
    prisma.permisoRol.upsert({
      where: { rolId_accionClave: { rolId, accionClave } },
      update: { puedeVer, puedeEditar },
      create: { rolId, accionClave, puedeVer, puedeEditar },
    });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    mozoRolId = (await prisma.rol.create({ data: { nombre: "mozo" } })).id;
    mozoId = (await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: base.sucursal.id, rolId: mozoRolId })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id })).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id })).id;
    await mockearUsuarioActual({ id: adminId, email: "admin@test.com", nombre: null });
  });

  describe("guardarPermisos", () => {
    const pedir = (rolId: string, accionClave: string, nuevo: { puedeVer: boolean; puedeEditar: boolean }) =>
      guardarPermisos([{ rolId, accionClave, anterior: SIN_PERMISO, nuevo }]);

    it.each([
      ["Ver", { puedeVer: true, puedeEditar: false }],
      ["Editar", { puedeVer: true, puedeEditar: true }],
    ])("rechaza darle %s de una acción de administrador a un rol personalizado (y no guarda nada)", async (_cual, nuevo) => {
      const r = await pedir(mozoRolId, DE_ADMIN_SUCURSAL, nuevo);
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("no puede tener");
      expect(r.mensaje).toContain("No se guardó nada");
      expect(await prisma.permisoRol.count({ where: { rolId: mozoRolId } })).toBe(0);
      expect(await prisma.registroAuditoria.count({ where: { entidad: "PermisoRol" } })).toBe(0);
    });

    it("rechaza lo mismo para «operador» y para una acción de empresa", async () => {
      expect((await pedir(base.operador.id, DE_ADMIN_EMPRESA, { puedeVer: true, puedeEditar: true })).ok).toBe(false);
      expect((await pedir(base.operador.id, DE_ADMIN_SUCURSAL, { puedeVer: true, puedeEditar: false })).ok).toBe(false);
      // (la semilla ya tiene una fila sin acceso por rol y acción: lo que no puede haber es una que dé Ver o Editar)
      expect(await prisma.permisoRol.count({ where: { rolId: base.operador.id, accionClave: { in: [DE_ADMIN_EMPRESA, DE_ADMIN_SUCURSAL] }, OR: [{ puedeVer: true }, { puedeEditar: true }] } })).toBe(0);
    });

    it("todo o nada: un lote con una celda legítima y una escalada no guarda NINGUNA", async () => {
      const r = await guardarPermisos([
        { rolId: mozoRolId, accionClave: DE_OPERARIO_SUCURSAL, anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: true } },
        { rolId: mozoRolId, accionClave: DE_ADMIN_SUCURSAL, anterior: SIN_PERMISO, nuevo: { puedeVer: true, puedeEditar: false } },
      ]);
      expect(r.ok).toBe(false);
      expect(await prisma.permisoRol.count({ where: { rolId: mozoRolId } })).toBe(0);
    });

    it("sí deja darle a un rol personalizado una acción de su nivel, y al admin una de administrador", async () => {
      expect((await pedir(mozoRolId, DE_OPERARIO_SUCURSAL, { puedeVer: true, puedeEditar: true })).ok).toBe(true);
      expect((await pedir(mozoRolId, DE_OPERARIO_EMPRESA, { puedeVer: true, puedeEditar: false })).ok).toBe(true);
      const sin = (await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId: base.admin.id, accionClave: DE_ADMIN_SUCURSAL } } }))!;
      expect([sin.puedeVer, sin.puedeEditar]).toEqual([true, true]);
    });

    it("sí deja SACAR una fila que un rol por debajo del piso ya tenía (limpiar un dato viejo)", async () => {
      await darFila(mozoRolId, DE_ADMIN_SUCURSAL);
      const r = await guardarPermisos([
        { rolId: mozoRolId, accionClave: DE_ADMIN_SUCURSAL, anterior: { puedeVer: true, puedeEditar: true }, nuevo: SIN_PERMISO },
      ]);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await prisma.permisoRol.findUniqueOrThrow({ where: { rolId_accionClave: { rolId: mozoRolId, accionClave: DE_ADMIN_SUCURSAL } } })).toMatchObject({
        puedeVer: false,
        puedeEditar: false,
      });
    });
  });

  describe("el gate ignora la fila aunque exista", () => {
    beforeEach(async () => {
      for (const clave of [DE_ADMIN_SUCURSAL, DE_ADMIN_EMPRESA]) {
        await darFila(mozoRolId, clave);
        await darFila(base.operador.id, clave);
      }
    });

    it("sucursal: requierePermiso / requierePermisoVer / obtenerMiNivelPermiso / accionesQueElUsuarioPuedeVer niegan al rol por debajo del piso", async () => {
      for (const usuarioId of [mozoId, operadorId]) {
        expect((await requierePermiso(usuarioId, base.sucursal.id, DE_ADMIN_SUCURSAL, prisma)).ok, "editar").toBe(false);
        expect((await requierePermisoVer(usuarioId, base.sucursal.id, DE_ADMIN_SUCURSAL, prisma)).ok, "ver").toBe(false);
        expect(await obtenerMiNivelPermiso(usuarioId, base.sucursal.id, DE_ADMIN_SUCURSAL, prisma)).toEqual({ ver: false, editar: false });
        expect([...(await accionesQueElUsuarioPuedeVer(usuarioId, base.sucursal.id, [DE_ADMIN_SUCURSAL], prisma))]).toEqual([]);
      }
    });

    it("empresa: requierePermisoDeEmpresa / requierePermisoVerDeEmpresa / obtenerMiNivelPermisoDeEmpresa niegan al rol por debajo del piso", async () => {
      for (const usuarioId of [mozoId, operadorId]) {
        expect((await requierePermisoDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, DE_ADMIN_EMPRESA, prisma)).ok, "editar").toBe(false);
        expect((await requierePermisoVerDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, DE_ADMIN_EMPRESA, prisma)).ok, "ver").toBe(false);
        expect(await obtenerMiNivelPermisoDeEmpresa(usuarioId, EMPRESA_POR_DEFECTO_ID, DE_ADMIN_EMPRESA, prisma)).toEqual({ ver: false, editar: false });
      }
    });

    it("menú: no muestra al rol por debajo del piso lo que la página le negaría", async () => {
      const visibles = await accionesDelMenuQueElUsuarioPuedeVer(
        mozoId,
        EMPRESA_POR_DEFECTO_ID,
        base.sucursal.id,
        [DE_ADMIN_SUCURSAL, DE_ADMIN_EMPRESA, DE_OPERARIO_SUCURSAL],
        prisma
      );
      expect([...visibles]).toEqual([]);
    });

    it("el admin (nivel administrador) sí pasa por las mismas acciones", async () => {
      expect((await requierePermiso(adminId, base.sucursal.id, DE_ADMIN_SUCURSAL, prisma)).ok).toBe(true);
      expect((await requierePermisoDeEmpresa(adminId, EMPRESA_POR_DEFECTO_ID, DE_ADMIN_EMPRESA, prisma)).ok).toBe(true);
      const visibles = await accionesDelMenuQueElUsuarioPuedeVer(adminId, EMPRESA_POR_DEFECTO_ID, base.sucursal.id, [DE_ADMIN_SUCURSAL, DE_ADMIN_EMPRESA], prisma);
      expect([...visibles].sort()).toEqual([DE_ADMIN_EMPRESA, DE_ADMIN_SUCURSAL].sort());
    });

    it("las acciones de piso operario siguen funcionando para el rol personalizado (el piso no rompe lo legítimo)", async () => {
      await darFila(mozoRolId, DE_OPERARIO_SUCURSAL);
      await darFila(mozoRolId, DE_OPERARIO_EMPRESA);
      expect((await requierePermiso(mozoId, base.sucursal.id, DE_OPERARIO_SUCURSAL, prisma)).ok).toBe(true);
      expect((await requierePermisoDeEmpresa(mozoId, EMPRESA_POR_DEFECTO_ID, DE_OPERARIO_EMPRESA, prisma)).ok).toBe(true);
    });

    it("un usuario con DOS membresías (una con rol operario, otra admin) pasa una acción de empresa de administrador por la del admin, no por la otra", async () => {
      const otra = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      await crearMembresia({ usuarioId: mozoId, sucursalId: otra.id, rolId: base.admin.id });
      expect((await requierePermisoDeEmpresa(mozoId, EMPRESA_POR_DEFECTO_ID, DE_ADMIN_EMPRESA, prisma)).ok).toBe(true);
      // …pero en la sucursal donde solo es mozo sigue sin poder con la acción de sucursal.
      expect((await requierePermiso(mozoId, base.sucursal.id, DE_ADMIN_SUCURSAL, prisma)).ok).toBe(false);
    });
  });

  describe("con dos empresas: el piso vale en cada una y nada cruza", () => {
    it("un rol personalizado de la empresa Norte con una fila de administrador no pasa; el admin de Norte sí; el de Central no tiene nada en Norte", async () => {
      await prismaAdmin.empresa.create({
        data: { id: "norte", nombre: "Norte", slug: "norte", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" },
      });
      const sucNorte = (await prismaAdmin.sucursal.create({ data: { nombre: "Norte", empresaId: "norte" } })).id;
      const mozoNorte = (await prismaAdmin.rol.create({ data: { nombre: "mozo", empresaId: "norte" } })).id;
      const adminNorte = (await prismaAdmin.rol.create({ data: { nombre: "admin", empresaId: "norte" } })).id;
      for (const rolId of [mozoNorte, adminNorte]) {
        for (const accionClave of [DE_ADMIN_SUCURSAL, DE_ADMIN_EMPRESA]) {
          await prismaAdmin.permisoRol.create({ data: { empresaId: "norte", rolId, accionClave, puedeVer: true, puedeEditar: true } });
        }
      }
      const usuarioMozo = await prismaAdmin.user.create({ data: { email: "mozo-norte@test.com" } });
      const usuarioAdmin = await prismaAdmin.user.create({ data: { email: "admin-norte@test.com" } });
      await crearMembresia({ usuarioId: usuarioMozo.id, sucursalId: sucNorte, rolId: mozoNorte });
      await crearMembresia({ usuarioId: usuarioAdmin.id, sucursalId: sucNorte, rolId: adminNorte });

      expect((await requierePermiso(usuarioMozo.id, sucNorte, DE_ADMIN_SUCURSAL, prismaAdmin)).ok).toBe(false);
      expect((await requierePermisoDeEmpresa(usuarioMozo.id, "norte", DE_ADMIN_EMPRESA, prismaAdmin)).ok).toBe(false);
      expect((await requierePermiso(usuarioAdmin.id, sucNorte, DE_ADMIN_SUCURSAL, prismaAdmin)).ok).toBe(true);
      expect((await requierePermisoDeEmpresa(usuarioAdmin.id, "norte", DE_ADMIN_EMPRESA, prismaAdmin)).ok).toBe(true);
      // El admin de la empresa Central no entra a Norte por su rol «admin».
      expect((await requierePermisoDeEmpresa(adminId, "norte", DE_ADMIN_EMPRESA, prismaAdmin)).ok).toBe(false);
    });
  });
});
