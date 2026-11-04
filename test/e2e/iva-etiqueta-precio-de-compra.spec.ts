import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { completarPasoFactura } from "./fixtures/compra-por-pasos";

/**
 * IVA-3: lo que se carga como importe de una compra es lo pagado, CON IVA incluido; la etiqueta lo dice. La ven las dos pantallas que
 * piden precio (`esCompraLike`, `core/movimientos/ui-config.ts`): Compra («Importe con IVA», en el paso 2 «Qué compraste») y Devolución a proveedor
 * («Precio total (con IVA incluido)»). El sujeto del mensaje de error de la compra («El importe no es un número válido.») lo fija `movimientos-compra-wizard.spec.ts`.
 */

test("/movimientos/compra: el importe de cada línea se llama «Importe con IVA»", async ({ paginaAutenticada: page }) => {
  const ahora = Date.now();
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_IVA_${ahora}`, nombre: `E2E Proveedor IVA ${ahora}` } });
  await page.goto("/movimientos/compra");
  await completarPasoFactura(page, { proveedor: proveedor.nombre });
  await expect(page.getByTestId("linea-de-compra").first().locator("label:has-text('Importe con IVA') input")).toBeVisible();
});

test("/movimientos/devolucion-proveedor: la etiqueta del precio dice «Precio total (con IVA incluido)»", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/devolucion-proveedor");
  await expect(page.getByLabel(/Precio total \(con IVA incluido\)/).first()).toBeVisible();
});
