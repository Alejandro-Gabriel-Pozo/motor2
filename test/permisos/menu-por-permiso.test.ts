import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { accionesQueElUsuarioPuedeVer } from "../../src/core/permisos/gate";
import { GRUPOS_NAV, accionesDelMenu, filtrarMenuPorPermiso } from "../../src/core/navegacion/estructura";
import type { AccionClave } from "../../src/core/permisos/acciones";

const CLAVES_REPORTES: AccionClave[] = ["ver_reportes_dinero", "ver_reportes_control", "ver_reportes_operativos", "ver_reportes_catalogo"];

describe("accionesQueElUsuarioPuedeVer", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un admin ve las cuatro claves de reportes", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES);
    expect([...visibles].sort()).toEqual([...CLAVES_REPORTES].sort());
  });

  it("un operador arranca sin ninguna de las claves nuevas de reportes (decisión del usuario: quedan sin asignar)", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect((await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES)).size).toBe(0);
  });

  it("conserva lo que un operador ya tenía por otra acción (Conteos físicos va con proceso_control)", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, ["proceso_control", "pagar_consignante", "promociones_config"]);
    expect([...visibles]).toEqual(["proceso_control"]);
  });

  it("dar «Ver» a un rol desde la matriz lo hace visible, sin dar «Editar»", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.permisoRol.update({
      where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "ver_reportes_operativos" } },
      data: { puedeVer: true },
    });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES);
    expect([...visibles]).toEqual(["ver_reportes_operativos"]);
  });

  it("una capacidad deshabilitada para la sucursal la oculta aunque el rol la tenga", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.capacidadSucursal.create({ data: { accionClave: "ver_reportes_dinero", sucursalId: base.sucursal.id, habilitado: false } });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES);
    expect(visibles.has("ver_reportes_dinero")).toBe(false);
    expect(visibles.has("ver_reportes_control")).toBe(true);
  });

  it("una membresía desactivada no ve nada", async () => {
    const base = await sembrarBase();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id, activo: false });
    expect((await accionesQueElUsuarioPuedeVer(inactivo.id, base.sucursal.id, CLAVES_REPORTES)).size).toBe(0);
  });
});

describe("filtrarMenuPorPermiso", () => {
  it("oculta los reportes que no se pueden ver, conserva los ítems sin acción y no deja grupos vacíos", () => {
    const grupos = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["ver_reportes_operativos"]));
    const reportes = grupos.find((g) => g.id === "reportes");
    expect(reportes?.items.map((i) => i.href).sort()).toEqual([
      "/reportes/historial",
      "/reportes/salud",
      "/reportes/trazabilidad",
      "/reportes/vencimientos",
    ]);
    // Los demás grupos no llevan `accion`: no se tocan.
    expect(grupos.find((g) => g.id === "catalogo")?.items.length).toBe(GRUPOS_NAV.find((g) => g.id === "catalogo")?.items.length);

    const sinNada = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>());
    expect(sinNada.find((g) => g.id === "reportes")).toBeUndefined();
  });

  it("accionesDelMenu trae cada acción una sola vez", () => {
    const acciones = accionesDelMenu();
    expect(new Set(acciones).size).toBe(acciones.length);
    expect(acciones).toContain("ver_reportes_dinero");
    expect(acciones).toContain("proceso_control");
  });
});
