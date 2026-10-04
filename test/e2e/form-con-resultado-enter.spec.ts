import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Regresión (hallazgo del dueño, 2026-09-25): Enter en un `<input>` de texto dentro de un `FormConResultado` NO tiene que
 * enviar el formulario — el comportamiento por defecto del navegador (Enter en un input dentro de un `<form>` con botón de
 * submit = submit) hacía que escribir en "Nombre" y apretar Enter guardara de verdad, sin haber tocado "Guardar". Solo se
 * reproduce en un formulario con VARIOS campos (no en uno de un solo input, como /catalogo/categorías): se prueba en "Nueva
 * sección de carta" (/carta), pero el arreglo está en el componente compartido, así que corrige todas las pantallas
 * que lo usan.
 */
test("Enter en Nombre no crea la sección; el botón sí", async ({ paginaAutenticada: page }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const nombre = `E2E Enter ${marca}`;

  try {
    await page.goto("/carta");
    const nuevaSeccion = page.locator("form", { has: page.getByRole("heading", { name: "Nueva sección de carta" }) });
    const campoNombre = nuevaSeccion.getByLabel("Nombre", { exact: true });
    await campoNombre.fill(nombre);
    await campoNombre.press("Enter");

    // Nada se guardó: ni aparece el mensaje de éxito, ni la sección existe en la base.
    await expect(nuevaSeccion.getByRole("status")).toHaveCount(0);
    expect(await prisma.seccionCarta.findFirst({ where: { nombre } })).toBeNull();
    // El campo conserva lo escrito: no se limpió (form.reset() solo corre tras un envío que salió bien).
    await expect(campoNombre).toHaveValue(nombre);

    // El botón sí guarda.
    await nuevaSeccion.getByRole("button", { name: "Crear sección" }).click();
    await expect(nuevaSeccion.getByRole("status")).toHaveText(`Sección de carta "${nombre}" creada.`);
  } finally {
    await prisma.seccionCarta.deleteMany({ where: { nombre } });
  }
});
