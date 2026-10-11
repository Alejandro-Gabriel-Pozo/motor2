import { test, expect } from "./fixtures/auth";

/**
 * IVA-3: lo que se carga como «Precio total» en una compra es lo pagado, CON IVA incluido; la etiqueta lo dice. La ven las dos pantallas que
 * piden precio (`esCompraLike`, `core/movimientos/ui-config.ts`): Compra y Devolución a proveedor. El sujeto del mensaje de error
 * («El precio total no es un número válido.») no cambia: lo fija `movimientos-compra-wizard.spec.ts`.
 */

for (const ruta of ["compra", "devolucion-proveedor"]) {
  test(`/movimientos/${ruta}: la etiqueta del precio dice «Precio total (con IVA incluido)»`, async ({ paginaAutenticada: page }) => {
    await page.goto(`/movimientos/${ruta}`);
    await expect(page.getByLabel(/Precio total \(con IVA incluido\)/).first()).toBeVisible();
  });
}
