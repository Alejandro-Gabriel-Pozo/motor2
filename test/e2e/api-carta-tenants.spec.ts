import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { asegurarBaseSeed } from "./fixtures/auth";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * GET /api/carta/tenants contra el build de producción (docs/plan-registro-tenants-2026-09-24.md, M5): que el route handler
 * compile y responda en `next start` igual que en Vitest, y sobre todo que la ruta estática `tenants` NO caiga en el hermano
 * dinámico `[sucursal]` (que respondería 404 "Sucursal no encontrada" para el id "tenants"). No usa sesión: el endpoint lo llama
 * un servidor externo, con token.
 */
const auth = { Authorization: `Bearer ${TOKEN_CARTA_E2E}` };
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-e2e";

test.describe("API del registro de tenants del portal", () => {
  test("sin token → 401", async ({ request }) => {
    const r = await request.get("/api/carta/tenants");
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  test("con token sobre una base sin registro → 200 con la lista vacía (la ruta estática le gana a [sucursal])", async ({ request }) => {
    await asegurarBaseSeed();
    expect(await prisma.sucursalPublica.count(), "otra prueba dejó filas de SucursalPublica").toBe(0);
    const r = await request.get("/api/carta/tenants", { headers: auth });
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const cuerpo = await r.json();
    expect(cuerpo.version).toBe(1);
    expect(cuerpo.tenants).toEqual([]);
  });

  test("con token y la sucursal Central en el portal → 200 con su fila", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const slug = `e2e-central-${Date.now()}`;
    await prisma.sucursalPublica.create({ data: { sucursalId: sucursal.id, slug, publicada: true, sheetId: SHEET, posX: 10, posY: 20, posW: 5, menuDesdeMotor2: true } });
    try {
      const r = await request.get("/api/carta/tenants", { headers: auth });
      expect(r.status()).toBe(200);
      const { tenants } = await r.json();
      expect(tenants).toEqual([
        {
          slug,
          etiqueta: sucursal.nombre,
          dominio: null,
          subtitulo: null,
          posicion: { x: 10, y: 20, w: 5, h: null },
          orden: 0,
          activo: true,
          sucursalId: sucursal.id,
          menuDesdeMotor2: true,
          temaDesdeMotor2: false,
          sheetId: SHEET,
          sheetMenuNombre: "Menu",
        },
      ]);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId: sucursal.id } });
    }
  });

  test("POST → 405 (solo se exporta GET)", async ({ request }) => {
    const r = await request.post("/api/carta/tenants", { headers: auth, data: {} });
    expect(r.status()).toBe(405);
  });
});
