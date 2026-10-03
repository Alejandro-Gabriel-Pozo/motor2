import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { accionesQueElUsuarioPuedeVer } from "../../src/core/permisos/gate";
import { GRUPOS_NAV, RUTA_INICIO, accionesDelMenu, elegirPantallaDeInicio, filtrarMenuPorPermiso } from "../../src/core/navegacion/estructura";
import { pantallaDeInicio, tarjetasDelUsuario } from "../../src/core/navegacion/inicio";
import { ACCIONES, type AccionClave, type AccionDeSucursal } from "../../src/core/permisos/acciones";

const CLAVES_REPORTES: AccionDeSucursal[] = ["reporte_resumen", "reporte_perdidas", "reporte_vencimientos", "reporte_sin_receta"];

describe("accionesQueElUsuarioPuedeVer", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un admin ve las claves de reportes (una por reporte)", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect([...visibles].sort()).toEqual([...CLAVES_REPORTES].sort());
  });

  it("un operador arranca sin ninguna de esas claves de reportes (quedan sin asignar); solo tiene Conteos físicos", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    expect((await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES, prisma)).size).toBe(0);
  });

  it("conserva lo que un operador ya tenía por otra acción (Conteos físicos tiene su propia clave, reporte_conteos, que heredó de proceso_control)", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, ["reporte_conteos", "pagar_consignante", "carta_promo_activar"], prisma);
    expect([...visibles]).toEqual(["reporte_conteos"]);
  });

  it("dar «Ver» a un rol desde la matriz lo hace visible, sin dar «Editar»", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await prisma.permisoRol.update({
      where: { rolId_accionClave: { rolId: base.operador.id, accionClave: "reporte_vencimientos" } },
      data: { puedeVer: true },
    });
    const visibles = await accionesQueElUsuarioPuedeVer(operador.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect([...visibles]).toEqual(["reporte_vencimientos"]);
  });

  it("una capacidad deshabilitada para la sucursal la oculta aunque el rol la tenga", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prisma.capacidadSucursal.create({ data: { accionClave: "reporte_resumen", sucursalId: base.sucursal.id, habilitado: false } });
    const visibles = await accionesQueElUsuarioPuedeVer(admin.id, base.sucursal.id, CLAVES_REPORTES, prisma);
    expect(visibles.has("reporte_resumen")).toBe(false);
    expect(visibles.has("reporte_perdidas")).toBe(true);
  });

  it("una membresía desactivada no ve nada", async () => {
    const base = await sembrarBase();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id, activo: false });
    expect((await accionesQueElUsuarioPuedeVer(inactivo.id, base.sucursal.id, CLAVES_REPORTES, prisma)).size).toBe(0);
  });
});

describe("filtrarMenuPorPermiso", () => {
  it("oculta los reportes que no se pueden ver, conserva los ítems sin acción y no deja grupos vacíos", () => {
    const grupos = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["reporte_trazabilidad", "reporte_vencimientos"]));
    const reportes = grupos.find((g) => g.id === "reportes");
    expect(reportes?.items.map((i) => i.href).sort()).toEqual(["/reportes/trazabilidad", "/reportes/vencimientos"]);
    // Todo el menú lleva `accion`: los grupos sin ningún ítem visible desaparecen, no solo Reportes.
    expect(grupos.map((g) => g.id)).toEqual(["reportes"]);

    const sinNada = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>());
    expect(sinNada).toEqual([]);
  });

  it("accionesDelMenu trae cada acción una sola vez", () => {
    const acciones = accionesDelMenu();
    expect(new Set(acciones).size).toBe(acciones.length);
    expect(acciones).toContain("reporte_resumen");
    expect(acciones).toContain("reporte_conteos");
    expect(acciones).toContain("proceso_control");
    expect(acciones).toContain("gestion_usuarios");
  });
});

describe("a dónde se manda al entrar", () => {
  it("al panel /inicio, tenga o no los reportes (ya no se entra por /reportes)", () => {
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["alta_producto", "reporte_resumen"]));
    expect(elegirPantallaDeInicio(menu)).toBe(RUTA_INICIO);
  });

  it("un rol con un solo módulo que no es el salón también pasa por /inicio (con una sola tarjeta)", () => {
    const menu = filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["ver_stock", "proceso_venta"]));
    expect(elegirPantallaDeInicio(menu)).toBe(RUTA_INICIO);
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["ver_stock"])))).toBe(RUTA_INICIO);
  });

  it("el salón más cualquier otro módulo va a /inicio: solo quien únicamente tiene salón entra directo al mapa", () => {
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["pos_mesas", "ver_stock"])))).toBe(RUTA_INICIO);
  });

  it("con solo pos_mesas (un rol «mozo» armado desde la matriz), directo al mapa de mesas", () => {
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>(["pos_mesas"])))).toBe("/mesas");
  });

  it("y si no tiene ninguna, también a /inicio, que lo explica (no a un mensaje de «no tenés permiso» de una página)", () => {
    expect(elegirPantallaDeInicio(filtrarMenuPorPermiso(GRUPOS_NAV, new Set<AccionClave>()))).toBe(RUTA_INICIO);
  });
});

describe("pantallaDeInicio (con la base)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  it("un admin y un operador entran por /inicio", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const ctxDe = (u: { id: string; email: string }) => ({ usuarioId: u.id, email: u.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", esAdminEnSucursal: false, membresias: [], empresaId: base.sucursal.empresaId, empresaSlug: "principal", empresaNombre: "Empresa principal", empresaZonaHoraria: "America/Argentina/Buenos_Aires", rolEmpresa: null, empresas: [], ...baseDeTest });

    expect(await pantallaDeInicio(ctxDe(admin))).toBe(RUTA_INICIO);
    expect(await pantallaDeInicio(ctxDe(operador))).toBe(RUTA_INICIO);
  });

  it("un rol con solo pos_mesas va a /mesas; admin y operador de fábrica entran por /inicio", async () => {
    const base = await sembrarBase();
    const mozo = await prisma.rol.create({ data: { nombre: "mozo" } });
    await prisma.permisoRol.create({ data: { rolId: mozo.id, accionClave: "pos_mesas", puedeVer: true, puedeEditar: true } });
    const usuario = await crearUsuarioConMembresia({ email: "mozo@test.com", sucursalId: base.sucursal.id, rolId: mozo.id });
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    const ctxDe = (u: { id: string; email: string }) => ({ usuarioId: u.id, email: u.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", esAdminEnSucursal: false, membresias: [], empresaId: base.sucursal.empresaId, empresaSlug: "principal", empresaNombre: "Empresa principal", empresaZonaHoraria: "America/Argentina/Buenos_Aires", rolEmpresa: null, empresas: [], ...baseDeTest });

    expect(await pantallaDeInicio(ctxDe(usuario))).toBe("/mesas");
    expect(await pantallaDeInicio(ctxDe(admin))).toBe(RUTA_INICIO);
    // El operador de fábrica no tiene pos_mesas (queda sin asignar): no entra al salón.
    expect(await pantallaDeInicio(ctxDe(operador))).toBe(RUTA_INICIO);
  });

  it("un rol sin ningún permiso va a /inicio, que lo explica", async () => {
    const base = await sembrarBase();
    const vacio = await prisma.rol.create({ data: { nombre: "sin-permisos" } });
    const usuario = await crearUsuarioConMembresia({ email: "vacio@test.com", sucursalId: base.sucursal.id, rolId: vacio.id });
    const destino = await pantallaDeInicio({ usuarioId: usuario.id, email: usuario.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", esAdminEnSucursal: false, membresias: [], empresaId: base.sucursal.empresaId, empresaSlug: "principal", empresaNombre: "Empresa principal", empresaZonaHoraria: "America/Argentina/Buenos_Aires", rolEmpresa: null, empresas: [], ...baseDeTest });
    expect(destino).toBe(RUTA_INICIO);
  });
});

describe("tarjetasDelUsuario (con la matriz real y la base)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  async function tarjetasDe(rolId: string, email: string, base: Awaited<ReturnType<typeof sembrarBase>>) {
    const u = await crearUsuarioConMembresia({ email, sucursalId: base.sucursal.id, rolId });
    return tarjetasDelUsuario({ usuarioId: u.id, email: u.email, sucursalId: base.sucursal.id, sucursalNombre: "Central", rolNombre: "x", esAdminEnSucursal: false, membresias: [], empresaId: base.sucursal.empresaId, empresaSlug: "principal", empresaNombre: "Empresa principal", empresaZonaHoraria: "America/Argentina/Buenos_Aires", rolEmpresa: null, empresas: [], ...baseDeTest });
  }

  it("un admin ve los 8 módulos (el salón incluido) y cada tarjeta lleva a la primera pantalla que puede abrir de su módulo", async () => {
    const base = await sembrarBase();
    const tarjetas = await tarjetasDe(base.admin.id, "admin@test.com", base);
    expect(tarjetas.map((t) => t.id)).toEqual(GRUPOS_NAV.map((g) => g.id));
    expect(tarjetas.find((t) => t.id === "pos")?.href).toBe("/mesas");
    for (const t of tarjetas) expect(t.href).toBe(GRUPOS_NAV.find((g) => g.id === t.id)!.items[0].href);
  });

  it("un operador de fábrica ve exactamente los módulos de sus permisos, y no el salón", async () => {
    const base = await sembrarBase();
    const tarjetas = await tarjetasDe(base.operador.id, "operador@test.com", base);
    const permisosDelOperador = new Set(ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes("operador")).map((a) => a.clave));
    const esperados = filtrarMenuPorPermiso(GRUPOS_NAV, permisosDelOperador).map((g) => g.id);
    expect(esperados.length).toBeGreaterThan(0);
    expect(tarjetas.map((t) => t.id)).toEqual(esperados);
    expect(tarjetas.map((t) => t.id)).not.toContain("pos");
  });

  it("un mozo (solo pos_mesas) tiene una sola tarjeta, el salón; un rol vacío, ninguna", async () => {
    const base = await sembrarBase();
    const mozo = await prisma.rol.create({ data: { nombre: "mozo" } });
    await prisma.permisoRol.create({ data: { rolId: mozo.id, accionClave: "pos_mesas", puedeVer: true, puedeEditar: true } });
    const vacio = await prisma.rol.create({ data: { nombre: "sin-permisos" } });
    expect((await tarjetasDe(mozo.id, "mozo@test.com", base)).map((t) => t.id)).toEqual(["pos"]);
    expect(await tarjetasDe(vacio.id, "vacio@test.com", base)).toEqual([]);
  });
});
