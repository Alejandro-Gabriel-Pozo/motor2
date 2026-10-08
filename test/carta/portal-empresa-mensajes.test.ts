import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { revalidarCartasPublicas } from "../../src/server/actions/carta/revalidar";
import { guardarPortalEmpresa } from "../../src/server/actions/carta/portal-empresa";

/**
 * Los textos EXACTOS de `guardarPortalEmpresa`, que NO invalida la carta pública a propósito (el portal lee la fila en cada pedido, sin caché) y que valida todo
 * ANTES de escribir (Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1), ANTES de mudarla a un caso de uso. `acciones-portal-empresa.test.ts` cubre qué se guarda,
 * pero no el texto del éxito (singular y plural), ni el del rechazo, ni que nunca se revalide la carta. Verde contra el código de antes de la mudanza y después.
 */
describe("portal de la empresa: mensajes, rechazos sin escribir y ninguna revalidación", () => {
  beforeEach(async () => {
    vi.mocked(revalidarCartasPublicas).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("éxito: el texto cuenta los valores (uno en singular, varios y ninguno en plural) y NO revalida la carta pública", async () => {
    expect(await guardarPortalEmpresa({ portal_titulo: "Sucursales" })).toEqual({
      ok: true,
      mensaje: "Apariencia del portal guardada (1 valor cargado; el resto usa el default). El portal la toma al recargarlo.",
    });
    expect(await guardarPortalEmpresa({ portal_titulo: "Sucursales", portal_card_bg: "#fff" })).toEqual({
      ok: true,
      mensaje: "Apariencia del portal guardada (2 valores cargados; el resto usa el default). El portal la toma al recargarlo.",
    });
    expect(await guardarPortalEmpresa({ portal_titulo: "", foo: "bar" })).toEqual({
      ok: true,
      mensaje: "Apariencia del portal guardada (0 valores cargados; el resto usa el default). El portal la toma al recargarlo.",
    });
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
    expect(await prisma.portalCartaEmpresa.count()).toBe(1);
  });

  it("rechazo: un campo inválido nombra su etiqueta, varios se juntan hasta cinco con «y N más», no escribe y tampoco revalida", async () => {
    expect(await guardarPortalEmpresa({ portal_titulo: "A", portal_card_bg: "red;position:fixed" })).toEqual({
      ok: false,
      mensaje: expect.stringMatching(/^Revisá este campo: Fondo de la tarjeta: /),
    });
    const varios = await guardarPortalEmpresa({
      portal_card_bg: "a;b",
      portal_header_bg: "a;b",
      portal_bg_overlay: "9",
      portal_bg_proporcion: "x",
      empresa_logo_url: "http://x.com/l.png",
      portal_bg_image_url: "http://x.com/m.png",
      portal_card_fuente_label: "1rem}*{display:none",
    });
    expect(varios.ok).toBe(false);
    expect(varios.mensaje).toMatch(/^Revisá estos campos: .* \(y \d+ más\)\.$/);
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
    expect(vi.mocked(revalidarCartasPublicas)).not.toHaveBeenCalled();
  });
});
