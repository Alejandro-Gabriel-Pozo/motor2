import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * El resultado de una acción tiene que VERSE. Estas pantallas usaban `<form action={async () => { "use server"; await accion(...) }}>`, que hace el
 * `await` y descarta el `ResultadoAccion`: si la acción devolvía `error(...)` (validación, duplicado, permiso), la persona no veía nada y la
 * pantalla parecía no haber reaccionado. Cada caso provoca un error REAL desde la UI y verifica que el mensaje aparece.
 *
 * Son errores que no se pueden ver desde Vitest (que llama a las acciones directo y sí recibe el resultado): lo que se prueba es que la pantalla
 * lo muestre. Los datos van con `Date.now()` y se limpia lo que se cree (varios specs comparten la base dentro de una corrida).
 */

test("categorías: un nombre con caracteres no permitidos muestra el error y no crea nada", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Categoría Inválida ${Date.now()} #!`;

  await page.goto("/catalogo/categorias");
  await expect(page.getByRole("heading", { name: /Categorías/ })).toBeVisible();

  await page.getByPlaceholder("nombre de la categoría").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();

  // Filtrado por texto: Next ya tiene un role="alert" propio y vacío (el anunciador de rutas), así que `getByRole("alert")` a secas matchea dos.
  await expect(page.getByRole("alert").filter({ hasText: "tiene caracteres no permitidos" })).toBeVisible();
  expect(await prisma.categoriaProducto.count({ where: { nombre } }), "no tenía que crearse nada").toBe(0);
});

test("unidades: un nombre repetido muestra el error, y al corregirlo se ve el «creada» junto a la fila nueva", async ({ paginaAutenticada: page }) => {
  const nuevo = `e2eu${Date.now()}`;

  try {
    await page.goto("/catalogo/unidades");
    await expect(page.getByRole("heading", { name: "Unidades de medida" })).toBeVisible();

    // «kg» ya existe en el seed de las pruebas.
    await page.getByPlaceholder("nombre (ej. kg)").fill("kg");
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByText('Ya existe una unidad llamada "kg".')).toBeVisible();

    // Corregido: el ok se ve Y la fila aparece. El mensaje tiene que sobrevivir al refresco de la ruta que pide la acción.
    await page.getByPlaceholder("nombre (ej. kg)").fill(nuevo);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.locator("tr", { hasText: nuevo })).toHaveCount(1);
    await expect(page.getByText(`Unidad "${nuevo}" creada.`)).toBeVisible();
  } finally {
    await prisma.unidad.updateMany({ where: { nombre: nuevo }, data: { activa: false } });
  }
});
