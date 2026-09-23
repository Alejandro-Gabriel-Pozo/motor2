import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * "Usar este valor" (Rendimiento real de recetas) nunca aplica directo: pide confirmación en la misma fila, con el porqué a la
 * vista, y ese contexto sigue visible en el editor de recetas donde el cambio se guarda de verdad — decisión del usuario,
 * 2026-09-21 (docs/planes-demo-y-claridad-reportes-2026-09-21.md §3). Se siembra directo en la base (compra de 20, venta de 10,
 * receta que dice 1 → sugiere 2) con fecha de HOY, para caer dentro del rango por defecto de la pantalla (últimos 30 días)
 * cualquier día del mes.
 */
test("pide confirmación con comprado/vendido antes de ir a aplicar el valor sugerido, y ese contexto sigue en el editor", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-RR-MP-${marca}`, nombre: `E2E Salsa Rendimiento ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-RR-PV-${marca}`, nombre: `E2E Pizza Rendimiento ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  // construirPools (P7) filtra whereDisponibleEn(sucursalId).
  await prisma.disponibilidadProducto.createMany({ data: [mp.id, pv.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });

  const hoy = new Date();
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 20, detalle: "Compra", precioTotal: 200, precioPorUnidadStock: 10 } });
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: hoy, usuarioId: admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -10, detalle: "Venta", precioTotal: 1000, precioPorUnidadStock: 100 } });

  try {
    await page.goto("/reportes/rendimiento-recetas");
    await expect(page.getByRole("heading", { name: "Rendimiento real de recetas" })).toBeVisible();
    const fila = page.getByRole("row", { name: new RegExp(pv.nombre) });
    await expect(fila).toContainText("1 kg"); // receta actual
    await expect(fila).toContainText("2 kg"); // rendimiento real: 20 ÷ 10

    // Abrir: pide confirmación, no navega todavía.
    const botonUsar = fila.getByRole("button", { name: `Usar este valor para ${pv.nombre} — ${mp.nombre}` });
    await botonUsar.click();
    const aviso = page.getByRole("alert").filter({ hasText: "¿Cambiar la receta" });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("de 1 a 2 kg");
    const contexto = page.getByText(/Comprado: 20 · Vendido: 10/);
    await expect(contexto).toBeVisible();
    await expect(contexto).toContainText("Confianza:");
    await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();

    // Cancelar: no navega, vuelve el foco al botón que lo abrió.
    await page.keyboard.press("Escape");
    await expect(aviso).toHaveCount(0);
    await expect(page).toHaveURL(/\/reportes\/rendimiento-recetas$/);
    await expect(botonUsar).toBeFocused();

    // Confirmar de verdad: recién ahí navega, con el contexto en la URL.
    await botonUsar.click();
    await page.getByRole("link", { name: "Sí, ir a aplicarlo" }).click();
    await page.waitForURL(new RegExp(`/catalogo/recetas/${pv.id}\\?.*sugerido=2`));

    // El editor de recetas muestra el mismo porqué, en el punto donde se guarda de verdad.
    const notaSugerido = page.getByRole("alert").filter({ hasText: "Sugerido por Rendimiento real de recetas" });
    await expect(notaSugerido).toBeVisible();
    await expect(notaSugerido).toContainText("tenías 1");
    await expect(notaSugerido).toContainText("compraste 20 y vendiste 10");
    await expect(page.locator('input[name="cantidad"]')).toHaveValue("2");
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: [compra.id, venta.id] } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [pv.id, mp.id] } } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});
