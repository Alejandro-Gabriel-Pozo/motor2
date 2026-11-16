import type { Locator } from "@playwright/test";

/**
 * Las pantallas plegadas (Frente 6, paso 3: «Opciones agotadas» por grupo y «Capacidades por sucursal» por módulo) esconden sus filas dentro de un `<details>` cerrado. Una persona lo abre tocando el
 * título; esto lo abre para el control que el spec va a tocar (en él y en los `<details>` que lo contienen). Si ya está abierto, no cambia nada.
 */
export async function abrirPlegables(destino: Locator): Promise<void> {
  await destino.evaluate((el) => {
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  });
}
