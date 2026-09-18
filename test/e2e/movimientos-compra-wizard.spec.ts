import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

async function elegirSelectPorOpcion(page: Page, textoOpcion: string) {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}

/**
 * Circuito Movimientos — wizard de Compra por proveedor con alta rápida
 * de producto inline ("+ Nuevo producto"), docs/plan-migracion.md §4.
 * Cubre el fix de QuickCrearProducto (commit 3bf2254): antes, crear el
 * producto inline reseteaba el formulario de Compra entero (proveedor +
 * fila), por el mismo bug de `<form>` anidado que catalogo-alta-
 * producto.spec.ts. Circuito completo: elegir proveedor → alta rápida →
 * completar cantidad/precio → confirmar → verificar en la base que el
 * MovimientoStock quedó bien (no solo que la UI mostró un mensaje).
 */
test("crear producto inline durante una Compra no pisa el proveedor ni la fila, y la compra se registra", async ({ paginaAutenticada: page, seccionId }) => {
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_${Date.now()}`, nombre: `E2E Proveedor ${Date.now()}` } });

  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  await page.goto("/movimientos/compra");

  // Selects por opción visible en vez de por posición — no asume orden
  // (otros specs/datos previos pueden agregar más proveedores/secciones).
  await elegirSelectPorOpcion(page, proveedor.nombre);
  await elegirSelectPorOpcion(page, seccion.nombre);

  await page.getByRole("button", { name: "+ Nuevo producto" }).click();
  const modal = page.locator(".fixed.inset-0");
  const nombreProducto = `E2E Producto Compra ${Date.now()}`;
  await modal.locator("input").first().fill(nombreProducto);
  await modal.locator("select").first().selectOption({ label: "kg" });
  await modal.getByRole("button", { name: "Crear" }).click();

  // El proveedor tiene que seguir seleccionado y la fila mostrar el
  // producto recién creado — antes del fix, los dos se perdían.
  await expect(page.locator('input[placeholder="Código o nombre…"]').first()).toHaveValue(nombreProducto);

  await page.locator("label:has-text('Cantidad') input").first().fill("10");
  await page.locator("label:has-text('Precio total') input").first().fill("1000");
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();

  const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: nombreProducto } });
  const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId } });
  expect(movimiento.proceso).toBe("COMPRA");
  expect(Number(movimiento.cantidad)).toBe(10);
  expect(Number(movimiento.precioTotal)).toBe(1000);
});
