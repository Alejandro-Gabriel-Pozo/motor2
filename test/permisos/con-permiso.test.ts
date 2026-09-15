import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { conPermiso } from "../../src/server/actions/con-permiso";
import { limitadorMutaciones } from "../../src/core/permisos/limitador-tasa";
import { ok } from "../../src/server/actions/tipos";

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
