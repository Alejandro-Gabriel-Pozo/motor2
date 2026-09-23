import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Activar / desactivar un producto desde la ficha y desde la lista. Desactivar se BLOQUEA mientras el producto esté en la receta vigente de un plato
 * disponible EN ESTA SUCURSAL o tenga saldo acá (ver dependenciasParaDesactivar): el mensaje del servidor dice qué es. Cada caso siembra lo suyo con
 * Date.now() y limpia en `finally`.
 */
async function sembrar(marca: number, conReceta: boolean, sucursalId: string) {
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E Insumo Desactivar ${marca}` } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-DS-MP-${marca}`, nombre: `E2E MP Desactivar ${marca}`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-DS-PV-${marca}`, nombre: `E2E Plato Desactivar ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.disponibilidadProducto.createMany({ data: [mp.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  if (conReceta) {
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  }
  return {
    mp,
    pv,
    limpiar: async () => {
      await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
      await prisma.registroAuditoria.deleteMany({ where: { entidad: "DisponibilidadProducto", entidadId: { in: [`${sucursalId}:${mp.id}`, `${sucursalId}:${pv.id}`] } } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
      await prisma.insumo.deleteMany({ where: { id: insumo.id } });
    },
  };
}

test("ficha: desactivar se bloquea si un plato disponible acá lo usa; sin ese uso se desactiva y se reactiva, sin recargar", async ({ paginaAutenticada: page, sucursalId }) => {
  const { mp, pv, limpiar } = await sembrar(Date.now(), true, sucursalId);
  try {
    await page.goto(`/catalogo/productos/${mp.id}`);
    await expect(page.getByRole("heading", { name: mp.nombre })).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __marca: number }).__marca = 1));

    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await page.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No se puede desactivar" })).toContainText(pv.nombre);
    const disponibleAca = async () =>
      (await prisma.disponibilidadProducto.findUniqueOrThrow({ where: { sucursalId_productoId: { sucursalId, productoId: mp.id } } })).disponible;
    expect(await disponibleAca(), "bloqueado: sigue disponible").toBe(true);

    // Sin el uso, sí. La ficha cambia SIN recargar la página.
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await page.getByRole("button", { name: "Desactivar", exact: true }).click();
    await page.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(page.getByText(/No disponible en/)).toBeVisible();
    expect(await disponibleAca()).toBe(false);

    await page.getByRole("button", { name: "Activar", exact: true }).click();
    await expect(page.getByText(/Disponible en/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca), "la página se recargó").toBe(1);
  } finally {
    await limpiar();
  }
});

test("lista: el botón Desactivar/Activar cambia la columna «Disponible acá» de su fila sin recargar", async ({ paginaAutenticada: page, sucursalId }) => {
  const { mp, limpiar } = await sembrar(Date.now(), false, sucursalId);
  try {
    await page.goto(`/catalogo/productos?q=${encodeURIComponent(mp.nombre)}`);
    const fila = page.locator("tr", { hasText: mp.nombre });
    await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __marca: number }).__marca = 1));

    await fila.getByRole("button", { name: "Desactivar", exact: true }).click();
    await fila.getByRole("button", { name: "Sí, desactivar" }).click();
    await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();

    await fila.getByRole("button", { name: "Activar", exact: true }).click();
    await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca), "la página se recargó").toBe(1);
  } finally {
    await limpiar();
  }
});
