import type { Page } from "@playwright/test";

/** Lo que había en el documento montado (`[data-imprimible]`) en el momento de llamar a `window.print()`. */
export interface Impresion {
  tipo: string | null;
  texto: string;
}

const CLAVE = "motor2-e2e:impresiones";

/**
 * Reemplaza `window.print()` en la página (docs/plan-imprimir-comanda-y-ticket-2026-09-25.md): el diálogo nativo de impresión no es
 * un `dialog` de Playwright (`page.on("dialog")` no lo ve) y bloquearía la prueba. Cada llamada guarda el tipo (`data-tipo`) y el texto
 * del documento montado; las impresiones se acumulan por pestaña (sessionStorage), también entre navegaciones. Con `simularAfterprint`
 * dispara además `afterprint`, como cuando la persona cierra el diálogo. Llamarla ANTES del primer `goto`.
 */
export async function interceptarImpresion(page: Page, opciones: { simularAfterprint?: boolean } = {}) {
  await page.addInitScript(
    ({ clave, simularAfterprint }) => {
      window.print = () => {
        const documento = document.querySelector<HTMLElement>("[data-imprimible]");
        const previas = JSON.parse(sessionStorage.getItem(clave) ?? "[]") as unknown[];
        sessionStorage.setItem(clave, JSON.stringify([...previas, { tipo: documento?.dataset.tipo ?? null, texto: documento?.textContent ?? "" }]));
        if (simularAfterprint) setTimeout(() => window.dispatchEvent(new Event("afterprint")), 0);
      };
    },
    { clave: CLAVE, simularAfterprint: opciones.simularAfterprint ?? false }
  );
}

/** Las impresiones de la pestaña desde que se interceptó, en orden. */
export async function impresiones(page: Page): Promise<Impresion[]> {
  return page.evaluate((clave) => JSON.parse(sessionStorage.getItem(clave) ?? "[]") as Impresion[], CLAVE);
}
