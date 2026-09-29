import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * Sincronizar el precio de un producto agrupado desde Catálogo (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): Fanta,
 * agrupada con Coca y Sprite a $5000 en «Gaseosa 500 CC», sube a $5500 desde su pantalla de edición. Al guardar aparece un bloque
 * aparte (no un confirm()) que ofrece aplicar $5500 también a los otros dos; al confirmarlo, la carta muestra $5500 en las tres
 * opciones, sin precios distintos.
 */
test("editar el precio de un producto agrupado ofrece aplicarlo a sus hermanos y, al confirmar, la carta queda pareja", async ({ paginaAutenticada: page, sucursalId, request }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Sync Cat ${marca}` } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sync Sección ${marca}` } });
  const [coca, sprite, fanta] = await Promise.all(
    ["Coca", "Sprite", "Fanta"].map((q) =>
      prisma.producto.create({ data: { codigo: `E2E_SYNC_${q}_${marca}`, nombre: `E2E Sync ${q} ${marca}`, tipo: "PV", categoriaId: categoria.id, precioVenta: 5000, unidadStockId: unidad.id } })
    )
  );
  const productoIds = [coca, sprite, fanta].map((p) => p.id);
  await prisma.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const item = await prisma.itemAgrupadoCarta.create({ data: { nombre: `E2E Sync Gaseosa ${marca}`, seccionCartaId: seccion.id } });
  await prisma.opcionItemAgrupadoCarta.createMany({ data: productoIds.map((productoId, orden) => ({ itemAgrupadoCartaId: item.id, productoId, orden })) });

  try {
    await page.goto(`/catalogo/productos/${fanta.id}/editar`);
    await expect(page.getByText(`Editar "${fanta.nombre}"`)).toBeVisible();
    // CampoNumero muestra el número formateado y pasa al crudo al tomar el foco: primero el foco, después se reemplaza el valor.
    const precio = page.getByLabel("Precio de venta", { exact: true });
    await precio.focus();
    await expect(precio).toHaveValue("5000");
    await precio.fill("5500");
    await precio.blur();
    await expect(precio).toHaveValue("5.500");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    const bloque = page.locator(`[data-sincronizar-precio-grupo="${item.nombre}"]`);
    await expect(bloque).toContainText(`«${item.nombre}» tiene 2 opciones más a otro precio: ${coca.nombre} ($5.000), ${sprite.nombre} ($5.000). ¿Aplicar $5.500 también?`);
    // Ya quedó guardado Fanta, y todavía nada más.
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: fanta.id } })).precioVenta)).toBe(5500);
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: coca.id } })).precioVenta)).toBe(5000);

    await bloque.getByRole("button", { name: "Aplicar $5.500 también" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${fanta.id}\\?guardado=cambios$`));

    const r = await request.get(`/api/carta/${sucursalId}`, { headers: { Authorization: `Bearer ${TOKEN_CARTA_E2E}` } });
    expect(r.status()).toBe(200);
    const s = (await r.json()).secciones.find((x: { id: string }) => x.id === seccion.id);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].precio).toBe(5500);
    expect(s.items[0].opciones.map((o: { precio: number }) => o.precio)).toEqual([5500, 5500, 5500]);
  } finally {
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { itemAgrupadoCartaId: item.id } });
    await prisma.itemAgrupadoCarta.deleteMany({ where: { id: item.id } });
    await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
    await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    await prisma.categoriaProducto.deleteMany({ where: { id: categoria.id } });
  }
});
