import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { getUsuarioActual } from "../../src/core/auth/session";
import { conEdicionDePermisos, conPermiso, conPermisoDeEmpresa } from "../../src/server/actions/con-permiso";
import { limitadorMutaciones } from "../../src/core/permisos/limitador-tasa";
import { ok, type ContextoDeAccion } from "../../src/server/actions/tipos";

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
