import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, sembrarBase, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { getUsuarioActual } from "../../src/server/sesion/session";
import { conEdicionDePermisos, conPermiso, conPermisoDeEmpresa, exigirTambienPermisoDeEmpresa } from "../../src/server/actions/con-permiso";
import { limitadorMutaciones } from "../../src/server/actions/limitador-de-mutaciones";
import { error, ok, type ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Los TRES envoltorios de mutación pasan por el limitador (O.33, paso L.1 del Hito 3): antes solo se probaba `conPermiso`, y `conPermisoDeEmpresa` y
 * `conEdicionDePermisos` (gobierno: usuarios de empresa, sucursales, roles, matriz) podían perderlo en una refactorización sin que nada lo viera. Además, el
 * limitador recibe `(usuarioId, ahora.getTime())` con la MISMA hora que después recibe la acción en `ctx.ahora` (Pureza 1.2: una sola lectura del reloj por pedido).
 */
const ENVOLTORIOS = [
  ["conPermiso", (fn: (ctx: ContextoDeAccion) => Promise<ReturnType<typeof ok>>) => conPermiso("gestion_usuarios", fn)],
  ["conPermisoDeEmpresa", (fn: (ctx: ContextoDeAccion) => Promise<ReturnType<typeof ok>>) => conPermisoDeEmpresa("alta_sucursal", fn)],
  ["conEdicionDePermisos", (fn: (ctx: ContextoDeAccion) => Promise<ReturnType<typeof ok>>) => conEdicionDePermisos("gestion_roles", fn)],
] as const;

describe("los tres envoltorios de mutación pasan por el limitador, con la hora del pedido", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(ENVOLTORIOS)("%s corta la mutación cuando el limitador dice que ya excedió (sin ejecutar la acción)", async (_nombre, envolver) => {
    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(true);
    const fn = vi.fn(async () => ok("no debería llegar acá"));
    expect(await envolver(fn)).toEqual({ ok: false, mensaje: "Demasiadas acciones seguidas — esperá un minuto e intentá de nuevo." });
    expect(fn).not.toHaveBeenCalled();
  });

  it.each(ENVOLTORIOS)("%s: el limitador recibe (usuarioId, ahora en ms) y la acción recibe ese mismo ahora", async (_nombre, envolver) => {
    const espia = vi.spyOn(limitadorMutaciones, "excedeLimite");
    let recibido: ContextoDeAccion | null = null;
    const r = await envolver(async (ctx) => {
      recibido = ctx;
      return ok("listo");
    });
    expect(r.ok).toBe(true);
    const ctx = recibido as ContextoDeAccion | null;
    expect(ctx).not.toBeNull();
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(ctx!.usuarioId, ctx!.ahora.getTime());
  });
});

describe("conPermiso — rate limiting", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("corta la mutación antes de tocar el gate de permisos ni ejecutar la acción, cuando el limitador dice que ya excedió", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    vi.spyOn(limitadorMutaciones, "excedeLimite").mockReturnValue(true);
    const fn = vi.fn(async () => ok("no debería llegar acá"));

    const resultado = await conPermiso("gestion_usuarios", fn);
    expect(resultado.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("con el limitador en su estado normal, una mutación con permiso válido sigue funcionando", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const fn = vi.fn(async () => ok("listo"));
    const resultado = await conPermiso("gestion_usuarios", fn);
    expect(resultado.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("conPermiso — sin sesión", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    vi.mocked(getUsuarioActual).mockReset();
  });

  // `redirect()` de Next lanza un error con `digest: "NEXT_REDIRECT;<tipo>;<url>;<código>;"`: es lo que el router del cliente interpreta.
  const haciaElLogin = { digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/login[;?]/) };

  it("sin sesión lleva al login y no ejecuta la acción (antes devolvía «No autenticado» y el formulario seguía abierto)", async () => {
    vi.mocked(getUsuarioActual).mockResolvedValue(null);
    const fn = vi.fn(async () => ok("no debería llegar acá"));

    await expect(conPermiso("gestion_usuarios", fn)).rejects.toMatchObject(haciaElLogin);
    expect(fn).not.toHaveBeenCalled();
  });

  it("un usuario con la membresía desactivada (sin ninguna sucursal activa) también va al login", async () => {
    const base = await sembrarBase();
    const inactivo = await crearUsuarioConMembresia({ email: "inactivo@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id, activo: false });
    await mockearUsuarioActual({ id: inactivo.id, email: inactivo.email, nombre: null });
    const fn = vi.fn(async () => ok("no debería llegar acá"));

    await expect(conPermiso("gestion_usuarios", fn)).rejects.toMatchObject(haciaElLogin);
    expect(fn).not.toHaveBeenCalled();
  });

  it("un permiso denegado sigue siendo un mensaje para el usuario, no un redirect", async () => {
    const base = await sembrarBase();
    const operador = await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: base.sucursal.id, rolId: base.operador.id });
    await mockearUsuarioActual({ id: operador.id, email: operador.email, nombre: null });
    const fn = vi.fn(async () => ok("no debería llegar acá"));

    const resultado = await conPermiso("gestion_usuarios", fn);
    expect(resultado.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * Fase 6, paso 6.14b: `exigirTambienPermisoDeEmpresa` es la SEGUNDA clave de una acción de empresa con dos claves (un comando compuesto): la primera la pide el envoltorio y esta, como primera línea de la
 * función. Pide lo mismo que `conPermisoDeEmpresa` (mismo gate y mismo mensaje) y no deja pasar a quien tiene una sola de las dos. La ficha que la declara con `+` se verifica en
 * `test/arquitectura/ficha-de-caso-de-uso.test.ts`.
 */
describe("exigirTambienPermisoDeEmpresa — la segunda clave de una acción de empresa", () => {
  /** La acción con dos claves, como la arma una Server Action: `alta_sucursal` en el envoltorio y `gestion_roles` adentro (las dos son de empresa y solo del admin en la semilla). */
  const conDosClaves = (fn: () => Promise<ReturnType<typeof ok>>) =>
    conPermisoDeEmpresa("alta_sucursal", async (ctx) => {
      const tambien = await exigirTambienPermisoDeEmpresa(ctx, "gestion_roles");
      if (!tambien.ok) return error(tambien.mensaje);
      return fn();
    });
  let base: Awaited<ReturnType<typeof sembrarBase>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    base = await sembrarBase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const entrarComo = async (email: string, rolId: string) => {
    const u = await crearUsuarioConMembresia({ email, sucursalId: base.sucursal.id, rolId });
    await mockearUsuarioActual({ id: u.id, email: u.email, nombre: null });
  };

  it("con las dos claves la acción corre", async () => {
    await entrarComo("admin@test.com", base.admin.id);
    const fn = vi.fn(async () => ok("listo"));
    expect((await conDosClaves(fn)).ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sin la segunda clave la acción NO corre y el mensaje es el de la denegación de siempre (aunque tenga la primera)", async () => {
    await prisma.permisoRol.updateMany({ where: { rolId: base.admin.id, accionClave: "gestion_roles" }, data: { puedeEditar: false, puedeVer: false } });
    await entrarComo("admin@test.com", base.admin.id);
    const fn = vi.fn(async () => ok("no debería llegar acá"));
    const solo = await conPermisoDeEmpresa("alta_sucursal", async () => ok("la primera sola alcanza para esta"));
    expect(solo.ok).toBe(true);
    const resultado = await conDosClaves(fn);
    expect(resultado.ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    // El mismo mensaje que da el envoltorio para esa clave: no hay un texto nuevo ni se revela cuál de las dos faltó de otra manera.
    const directo = await conPermisoDeEmpresa("gestion_roles", async () => ok("no debería llegar acá"));
    expect(resultado).toEqual(directo);
  });

  it("sin la primera clave el envoltorio corta antes de mirar la segunda", async () => {
    await entrarComo("operador@test.com", base.operador.id);
    const fn = vi.fn(async () => ok("no debería llegar acá"));
    expect((await conDosClaves(fn)).ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
