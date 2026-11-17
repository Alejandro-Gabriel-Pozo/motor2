import type { Page } from "@playwright/test";
import { MENU_POR_AREAS } from "../../../src/core/navegacion/menu-por-areas";

export { MENU_POR_AREAS };

/**
 * Con el menú por áreas (Frente 6, paso 5) el lateral abre solo el área de la pantalla abierta y las otras vienen plegadas: una persona toca el nombre del área para ver sus pantallas. Esto abre todas las que estén
 * plegadas (con el menú de siempre no hay nada que abrir: no cambia nada).
 */
export async function abrirAreasDelMenu(page: Page): Promise<void> {
  if (!MENU_POR_AREAS) return;
  const plegadas = page.locator("aside nav button[aria-expanded='false']");
  for (let n = await plegadas.count(); n > 0; n--) await plegadas.first().click();
}
