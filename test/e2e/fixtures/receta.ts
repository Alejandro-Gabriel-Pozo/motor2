import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Elige una materia prima en el buscador de «Agregar ingrediente» de una receta (la central o la propia de la sucursal): escribe el nombre, espera el resultado y lo elige. Si ya había una
 * elegida (el campo muestra su línea con «Cambiar»), primero vuelve al buscador. `etiqueta` es el nombre accesible del buscador («Materia prima» o «Materia prima de la receta propia»).
 */
export async function elegirMateriaPrima(formulario: Locator, etiqueta: string, nombre: string): Promise<void> {
  const cambiar = formulario.getByRole("button", { name: /^Cambiar/ });
  if (await cambiar.isVisible()) await cambiar.click();
  const buscador = formulario.getByRole("combobox", { name: etiqueta, exact: true });
  await buscador.fill(nombre);
  await formulario.getByRole("option", { name: nombre }).click();
  await expect(formulario.locator("[data-materia-prima-elegida]")).toContainText(nombre);
}
