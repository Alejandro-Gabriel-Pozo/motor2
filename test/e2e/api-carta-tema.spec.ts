import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { asegurarBaseSeed } from "./fixtures/auth";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * GET /api/carta/[sucursal]/tema contra el build de producción (docs/plan-tema-carta-2026-09-24.md, M7): que el route handler
 * anidado bajo el segmento dinámico `[sucursal]` (que tiene su propio route.ts) compile y responda en `next start` igual que en
 * Vitest. No usa sesión: el endpoint lo llama un servidor externo, con token.
 */
const auth = { Authorization: `Bearer ${TOKEN_CARTA_E2E}` };

test.describe("API del tema de la carta", () => {
  test("sin token → 401", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const r = await request.get(`/api/carta/${sucursal.id}/tema`);
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  test("con token e id inexistente → 404", async ({ request }) => {
    const r = await request.get("/api/carta/no-existe/tema", { headers: auth });
    expect(r.status()).toBe(404);
    expect(await r.json()).toEqual({ error: "Tema no encontrado" });
  });

  test("con token, «Central» sin tema → 404", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    expect(await prisma.temaCartaSucursal.count({ where: { sucursalId: sucursal.id } }), "otra prueba dejó un tema en Central").toBe(0);
    const r = await request.get(`/api/carta/${sucursal.id}/tema`, { headers: auth });
    expect(r.status()).toBe(404);
  });

  test("con un tema aplicado → 200 con las 67 claves y un valor de cada bloque tal cual; al desaplicar → 404", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const valores = {
      restaurante_nombre: "E2E La Parrilla", // A
      color_especial_item_nombre: "#aa3300", // B
      carta_texto_portada_cta: "Deslizá para ver la carta", // C
      carta_banda_alto_desktop: "clamp(90px, 20vh, 160px)", // D
    };
    await prisma.temaCartaSucursal.create({ data: { sucursalId: sucursal.id, aplicarEnCarta: true, valores } });
    try {
      const r = await request.get(`/api/carta/${sucursal.id}/tema`, { headers: auth });
      expect(r.status()).toBe(200);
      expect(r.headers()["cache-control"]).toContain("no-store");
      const cuerpo = await r.json();
      expect(cuerpo.version).toBe(1);
      expect(cuerpo.sucursalId).toBe(sucursal.id);
      expect(Object.keys(cuerpo.valores)).toHaveLength(67);
      expect(Object.keys(cuerpo.valores).filter((c) => c.startsWith("precio_"))).toEqual([]);
      expect(cuerpo.valores).toMatchObject({ ...valores, color_marca: null });

      await prisma.temaCartaSucursal.updateMany({ where: { sucursalId: sucursal.id }, data: { aplicarEnCarta: false } });
      const desaplicado = await request.get(`/api/carta/${sucursal.id}/tema`, { headers: auth });
      expect(desaplicado.status()).toBe(404);
    } finally {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId: sucursal.id } });
    }
  });

  test("POST → 405 (solo se exporta GET)", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const r = await request.post(`/api/carta/${sucursal.id}/tema`, { headers: auth, data: {} });
    expect(r.status()).toBe(405);
  });
});
