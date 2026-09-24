import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { asegurarBaseSeed } from "./fixtures/auth";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * GET /api/carta/[sucursal] contra el build de producción (docs/plan-carta-catalogo-2026-09-24.md, M6): que el route handler
 * compile y responda en `next start` igual que en Vitest — auth de servicio, 404, 200 con la forma v1 y 405 para otro método.
 * No usa sesión: el endpoint lo llama un servidor externo, con token.
 */
const auth = { Authorization: `Bearer ${TOKEN_CARTA_E2E}` };

test.describe("API de la carta pública", () => {
  test("sin token → 401", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const r = await request.get(`/api/carta/${sucursal.id}`);
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: "No autorizado" });
  });

  test("token incorrecto → 401", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const r = await request.get(`/api/carta/${sucursal.id}`, { headers: { Authorization: "Bearer otro" } });
    expect(r.status()).toBe(401);
  });

  test("id inexistente con token → 404", async ({ request }) => {
    const r = await request.get("/api/carta/no-existe-esta-sucursal", { headers: auth });
    expect(r.status()).toBe(404);
    expect(await r.json()).toEqual({ error: "Sucursal no encontrada" });
  });

  test("POST → 405 (solo se exporta GET)", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const r = await request.post(`/api/carta/${sucursal.id}`, { headers: auth, data: {} });
    expect(r.status()).toBe(405);
  });

  test("con token → 200: la sección, el PV visible con su precio numérico y la promo; nada interno", async ({ request }) => {
    const { sucursal } = await asegurarBaseSeed();
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
    const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Carta Cat ${marca}` } });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Carta Sección ${marca}`, titulo: "Del fuego", orden: 1 } });
    const producto = await prisma.producto.create({
      data: { codigo: `E2E_CARTA_${marca}`, nombre: `E2E Carta Bife ${marca}`, tipo: "PV", categoriaId: categoria.id, precioVenta: 34000, observaciones: "nota interna", unidadStockId: unidad.id },
    });
    try {
      await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal.id, productoId: producto.id, disponible: true } });
      await prisma.categoriaSeccionCarta.create({ data: { categoriaId: categoria.id, seccionCartaId: seccion.id } });
      await prisma.contenidoCartaProducto.create({ data: { productoId: producto.id, visibleEnCarta: true, tags: ["Regional"], especial: true } });
      await prisma.promoCarta.create({ data: { sucursalId: sucursal.id, seccionCartaId: seccion.id, titulo: `E2E Promo ${marca}`, precio: 25000 } });

      const r = await request.get(`/api/carta/${sucursal.id}`, { headers: auth });
      expect(r.status()).toBe(200);
      expect(r.headers()["cache-control"]).toContain("no-store");
      const carta = await r.json();
      expect(carta.version).toBe(1);
      expect(carta.sucursal).toEqual({ id: sucursal.id, nombre: sucursal.nombre });
      const s = carta.secciones.find((x: { id: string }) => x.id === seccion.id);
      expect(s, "la sección sembrada no aparece en la carta").toBeTruthy();
      expect(s.titulo).toBe("Del fuego");
      expect(s.items).toEqual([
        { productoId: producto.id, nombre: producto.nombre, categoria: categoria.nombre, descripcion: null, precio: 34000, tags: ["Regional"], especial: true, imagenUrl: null },
      ]);
      expect(s.promos).toEqual([{ id: expect.any(String), titulo: `E2E Promo ${marca}`, descripcion: null, precio: 25000, orden: 0 }]);
      const texto = JSON.stringify(carta);
      expect(texto).not.toContain(producto.codigo);
      expect(texto).not.toContain("nota interna");
    } finally {
      // Las filas de carta primero: referencian producto/categoría/sucursal con RESTRICT.
      await prisma.promoCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.categoriaSeccionCarta.deleteMany({ where: { seccionCartaId: seccion.id } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
      await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
    }
  });
});
