import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Lo que se mide en CADA diálogo del salón sobre el `Dialogo` del sistema (ver `test/e2e/pos-dialogos.spec.ts`): las Server Actions retenidas a propósito para dejar la acción «en curso», el foco, Escape y el fondo.
 */

/** Frena las Server Actions de la página hasta `liberar()`; `vistas` cuenta las que salieron. */
export async function retenerAcciones(page: Page) {
  let liberar!: () => void;
  const pausa = new Promise<void>((resolver) => (liberar = resolver));
  const vistas: string[] = [];
  await page.route(
    () => true,
    async (ruta) => {
      const pedido = ruta.request();
      if (pedido.method() === "POST" && pedido.headers()["next-action"]) {
        vistas.push(pedido.headers()["next-action"]);
        await pausa;
      }
      await ruta.continue();
    },
  );
  return { vistas, liberar };
}

/** El foco está dentro del diálogo abierto. */
const focoEnElDialogo = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));

/** Escape y el fondo cierran, y el foco vuelve al disparador. Deja el diálogo cerrado. */
export async function cierraConEscapeYConElFondo(page: Page, abrir: () => Promise<void>, dialogo: ReturnType<Page["getByRole"]>, disparador: ReturnType<Page["getByRole"]>) {
  await abrir();
  await expect(dialogo).toBeVisible();
  expect(await focoEnElDialogo(page), "el foco queda adentro del diálogo").toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  await expect(disparador, "Escape devuelve el foco al botón que abrió el diálogo").toBeFocused();
  await abrir();
  await expect(dialogo).toBeVisible();
  await page.mouse.click(4, 4); // esquina de la pantalla: el fondo
  await expect(dialogo).toBeHidden();
}

/** Con la acción en curso el diálogo no se cierra por ningún camino. */
export async function noSeCierraEnCurso(page: Page, dialogo: ReturnType<Page["getByRole"]>) {
  await page.keyboard.press("Escape");
  await expect(dialogo, "Escape no lo cierra con la acción en curso").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogo, "un segundo Escape seguido tampoco").toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialogo, "el clic en el fondo no lo cierra con la acción en curso").toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Cerrar" }), "la ✕ queda deshabilitada").toBeDisabled();
}
