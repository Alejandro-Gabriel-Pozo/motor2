import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { accionesQueElUsuarioPuedeVer } from "../../src/core/permisos/gate";
import { GRUPOS_NAV, RUTA_SIN_PANTALLAS, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso } from "../../src/core/navegacion/estructura";
import { pantallaDeInicio } from "../../src/core/navegacion/inicio";
import type { AccionClave } from "../../src/core/permisos/acciones";

const CLAVES_REPORTES: AccionClave[] = ["ver_reportes_dinero", "ver_reportes_control", "ver_reportes_operativos", "ver_reportes_catalogo"];

describe("accionesQueElUsuarioPuedeVer", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un admin ve las cuatro claves de reportes", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect([...visibles].sort()).toEqual([...CLAVES_REPORTES].sort());
  });

  it("un operador arranca sin ninguna de las claves nuevas de reportes (decisión del usuario: quedan sin asignar)", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect((await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES, prisma)).size).toBe(0);
  });

  it("conserva lo que un operador ya tenía por otra acción (Conteos físicos va con proceso_control)", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, ["proceso_control", "pagar_consignante", "promociones_config"], prisma);
    expect([...visibles]).toEqual(["proceso_control"]);
  });

  it("dar «Ver» a un rol desde la matriz lo hace visible, sin dar «Editar»", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.permisoRol.update({
      where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "ver_reportes_operativos" } },
      data: { puedeVer: true },
    });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect([...visibles]).toEqual(["ver_reportes_operativos"]);
  });

  it("una capacidad deshabilitada para la sucursal la oculta aunque el rol la tenga", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.capacidadSucursal.create({ data: { accionClave: "ver_reportes_dinero", sucursalId: base.sucursal.id, habilitado: false } });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect(visibles.has("ver_reportes_dinero")).toBe(false);
    expect(visibles.has("ver_reportes_control")).toBe(true);
  });

  it("una membresía desactivada no ve nada", async () => {
    const base = await sembrarBase();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id, activo: false });
    expect((await accionesQueElUsuarioPuedeVer(inactivo.id, base.sucursal.id, CLAVES_REPORTES, prisma)).size).toBe(0);
  });
});

describe("filtrarMenuPorPermiso", () => {
  it("oculta los reportes que no se pueden ver, conserva los ítems sin acción y no deja grupos vacíos", () => {
    const grupos = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["ver_reportes_operativos"]));
    const reportes = grupos.find((g) => g.id === "reportes");
    expect(reportes?.items.map((i) => i.href).sort()).toEqual([
      "/reportes/historial",
      "/reportes/rotacion-mesas",
      "/reportes/salud",
      "/reportes/trazabilidad",
      "/reportes/vencimientos",
    ]);
    // Todo el menú lleva `accion`: los grupos sin ningún ítem visible desaparecen, no solo Reportes.
    expect(grupos.map((g) => g.id)).toEqual(["reportes"]);

    const sinNada = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>());
    expect(sinNada).toEqual([]);
  });

  it("accionesDelMenu trae cada acción una sola vez", () => {
    const acciones = accionesDelMenu();
    expect(new Set(acciones).size).toBe(acciones.length);
    expect(acciones).toContain("ver_reportes_dinero");
    expect(acciones).toContain("proceso_control");
    expect(acciones).toContain("gestion_usuarios");
  });
});

describe("a dónde se manda al entrar", () => {
  it("a /reportes si puede verlo (como siempre), aunque haya otros ítems antes en el menú", () => {
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["alta_producto", "ver_reportes_dinero"]));
    expect(elegirPantallaDeInicio(menu)).toBe("/reportes");
  });

  it("si no, a la primera pantalla del menú que puede abrir", () => {
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["ver_stock", "proceso_venta"]));
    expect(elegirPantallaDeInicio(menu)).toBe("/movimientos/venta");
  });

  it("con solo pos_mesas (un rol «mozo» armado desde la matriz), directo al mapa de mesas", () => {
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["pos_mesas"])))).toBe("/mesas");
  });

  it("y si no tiene ninguna, a la pantalla que lo explica (no a un mensaje de «no tenés permiso» de una página)", () => {
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>()))).toBe(RUTA_SIN_PANTALLAS);
  });
});

describe("pantallaDeInicio (con la base)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un admin va a /reportes; un operador, a una pantalla que sí puede abrir", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const ctxDe = (u: { id: string; email: string }) => ({ usuarioId: u.id, email: u.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", membresias: [], ...baseDeTest });

    expect(await pantallaDeInicio(ctxDe(admin))).toBe("/reportes");

    const destino = await pantallaDeInicio(ctxDe(operador));
    expect(destino).not.toBe("/reportes");
    expect(destino).not.toBe(RUTA_SIN_PANTALLAS); // el operador de fábrica tiene varias pantallas
  });

  it("un rol con solo pos_mesas va a /mesas; admin y operador de fábrica siguen entrando por donde entraban", async () => {
    const base = await sembrarBase();
    const mozo = await prisma.rol.create({ data: { nombre: "mozo" } });
    await prisma.permisoRol.create({ data: { rolId: mozo.id, accionClave: "pos_mesas", puedeVer: true, puedeEditar: true } });
    const usuario = await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: base.sucursal.id, rolId: mozo.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ctxDe = (u: { id: string; email: string }) => ({ usuarioId: u.id, email: u.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", membresias: [], ...baseDeTest });

    expect(await pantallaDeInicio(ctxDe(usuario))).toBe("/mesas");
    expect(await pantallaDeInicio(ctxDe(admin))).toBe("/reportes");
    // El operador de fábrica no tiene pos_mesas (queda sin asignar): su pantalla de inicio no cambia.
    expect(await pantallaDeInicio(ctxDe(operador))).not.toBe("/mesas");
  });

  it("un rol sin ningún permiso va a la pantalla que lo explica", async () => {
    const base = await sembrarBase();
    const vacio = await prisma.rol.create({ data: { nombre: "sin-permisos" } });
    const usuario = await crearUsuarioConMembresia({ email: "vacio@test.com", sucursalId: base.sucursal.id, rolId: vacio.id });
    const destino = await pantallaDeInicio({ usuarioId: usuario.id, email: usuario.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", membresias: [], ...baseDeTest });
    expect(destino).toBe(RUTA_SIN_PANTALLAS);
  });
});
