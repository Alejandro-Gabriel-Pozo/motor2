import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { laMatrizDelRolLaEditaSoloElGerente, mensajeSiNoPuedeEditarLaMatrizDelRol, SIN_PERMISO } from "../../src/core/permisos/matriz";
import { requierePermisoDeEmpresa } from "../../src/server/acceso/gate";
import { guardarPermisos } from "../../src/server/actions/permisos/permisos";

/**
 * D13/D14 (aprobado por el dueño el 2026-10-08, commit propio al final del Hito 3; ADR-027): la matriz del rol `admin` —y de los roles de rango 2, cuando existan
 * (F3)— la edita SOLO el gerente de la empresa. Hasta acá un administrador que no era el gerente podía sacarle una acción al rol admin y con eso recortársela al
 * gerente (que usa el mismo rol), o agrandar su propio rol: lo fijaba el caso (c) de `caracterizacion-supuestos-rbac.test.ts`, que este mismo commit edita.
 *
 * La regla es pura (`core/permisos/matriz.ts`) y la aplica el caso de uso `guardarPermisos`, con quien actúa leído de la base dentro de la transacción. El permiso
 * de la pantalla (`gestion_permisos`) no cambia: la matriz de acceso queda igual.
 */
const MENSAJE = "Solo el gerente de la empresa puede editar los permisos del rol administrador. No se guardó nada.";

describe("D13/D14, la regla pura", () => {
  const operario = { rolEmpresa: null, esAdminEnElContexto: false };
  const administrador = { rolEmpresa: null, esAdminEnElContexto: true };
  const gerente = { rolEmpresa: "gerente", esAdminEnElContexto: true };

  it("la matriz que edita solo el gerente es la del rol de clave «admin» (nivel administrador o más frente al piso); la de operador y la de un rol personalizado, no", () => {
    expect(laMatrizDelRolLaEditaSoloElGerente({ clave: "admin" })).toBe(true);
    expect(laMatrizDelRolLaEditaSoloElGerente({ clave: "operador" })).toBe(false);
    expect(laMatrizDelRolLaEditaSoloElGerente({ clave: null })).toBe(false);
  });

  it("el rol admin: rechaza al administrador y al operario, deja al gerente; los otros roles no los frena esta regla", () => {
    expect(mensajeSiNoPuedeEditarLaMatrizDelRol(administrador, { clave: "admin" })).toBe(MENSAJE);
    expect(mensajeSiNoPuedeEditarLaMatrizDelRol(operario, { clave: "admin" })).toBe(MENSAJE);
    expect(mensajeSiNoPuedeEditarLaMatrizDelRol(gerente, { clave: "admin" })).toBeNull();
    expect(mensajeSiNoPuedeEditarLaMatrizDelRol(administrador, { clave: "operador" })).toBeNull();
    expect(mensajeSiNoPuedeEditarLaMatrizDelRol(administrador, { clave: null })).toBeNull();
  });
});

describe("D13/D14 por la Server Action, contra Postgres", () => {
  let base: Awaited<ReturnType<typeof sembrarBase>>;
  let admin: { id: string; email: string };
  let gerente: { id: string; email: string };

  const celda = async (rolId: string, accionClave: string) => {
    const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId, accionClave } } });
    return f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : SIN_PERMISO;
  };
  const foto = async () => ({ matriz: await prisma.permisoRol.findMany({ orderBy: { id: "asc" } }), auditoria: await prisma.registroAuditoria.count({ where: { entidad: "PermisoRol" } }) });
  const actuarComo = (u: { id: string; email: string }) => mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
  });
  afterEach(() => __setCookieDeTestParaSucursal(undefined));

  it("un administrador que no es el gerente NO edita la matriz del rol admin: rechazo y no cambia nada (ni la celda ni la auditoría, y el gerente conserva la acción)", async () => {
    await actuarComo(admin);
    const antes = await foto();
    const r = await guardarPermisos([{ rolId: base.admin.id, accionClave: "alta_sucursal", anterior: await celda(base.admin.id, "alta_sucursal"), nuevo: SIN_PERMISO }]);
    expect(r).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await foto()).toEqual(antes);
    expect((await requierePermisoDeEmpresa(gerente.id, EMPRESA_POR_DEFECTO_ID, "alta_sucursal", prisma)).ok).toBe(true);
  });

  it("todo o nada: un lote con una celda del rol operador (permitida) y una del rol admin no guarda NINGUNA", async () => {
    await actuarComo(admin);
    const antes = await foto();
    const r = await guardarPermisos([
      { rolId: base.operador.id, accionClave: "reporte_salud", anterior: await celda(base.operador.id, "reporte_salud"), nuevo: { puedeVer: true, puedeEditar: false } },
      { rolId: base.admin.id, accionClave: "proceso_venta", anterior: await celda(base.admin.id, "proceso_venta"), nuevo: { puedeVer: true, puedeEditar: false } },
    ]);
    expect(r).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await foto()).toEqual(antes);
  });

  it("el mismo administrador sí edita la matriz del rol operador (la regla es solo para el rol admin)", async () => {
    await actuarComo(admin);
    const r = await guardarPermisos([{ rolId: base.operador.id, accionClave: "reporte_salud", anterior: await celda(base.operador.id, "reporte_salud"), nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await celda(base.operador.id, "reporte_salud")).toEqual({ puedeVer: true, puedeEditar: false });
  });

  it("el gerente sí edita la matriz del rol admin, con su auditoría", async () => {
    await actuarComo(gerente);
    const r = await guardarPermisos([{ rolId: base.admin.id, accionClave: "proceso_venta", anterior: await celda(base.admin.id, "proceso_venta"), nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await celda(base.admin.id, "proceso_venta")).toEqual({ puedeVer: true, puedeEditar: false });
    expect(await prisma.registroAuditoria.count({ where: { entidad: "PermisoRol", actorId: gerente.id } })).toBeGreaterThan(0);
  });

  it("un pedido que no cambia nada del rol admin sigue siendo «No hay cambios» (la regla mira lo que de verdad se guardaría)", async () => {
    await actuarComo(admin);
    const r = await guardarPermisos([{ rolId: base.admin.id, accionClave: "gestion_permisos", anterior: await celda(base.admin.id, "gestion_permisos"), nuevo: { puedeVer: true, puedeEditar: false } }]);
    expect(r).toEqual({ ok: false, mensaje: "No hay cambios para guardar." });
  });
});
