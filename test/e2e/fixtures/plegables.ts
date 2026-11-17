import type { Locator, Page } from "@playwright/test";

/**
 * Las pantallas plegadas (Frente 6, paso 3: «Opciones agotadas» por grupo y «Capacidades por sucursal» por módulo) esconden sus filas dentro de un `<details>` cerrado. Una persona lo abre tocando el
 * título; esto lo abre para el control que el spec va a tocar (en él y en los `<details>` que lo contienen). Si ya está abierto, no cambia nada.
 */
export async function abrirPlegables(destino: Locator): Promise<void> {
  await destino.evaluate((el) => {
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  });
}

/**
 * «Permisos» en lectura (Frente 6, paso 3) muestra un renglón por módulo y las acciones solo al abrirlo: esto abre todos los módulos tocando sus botones, como lo haría una persona. Con el interruptor apagado
 * (o en la edición, donde se ven todas) no hay nada que abrir y no cambia nada.
 */
export async function abrirModulosDePermisos(page: Page): Promise<void> {
  await page.locator("[data-modulo-de-permisos] button[aria-expanded='false']").evaluateAll((botones) => botones.forEach((b) => (b as HTMLButtonElement).click()));
}
