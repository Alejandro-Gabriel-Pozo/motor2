import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Medidas del celular para los specs «móvil»: el viewport de referencia (375 × 812, un celular chico de los comunes), el desborde horizontal de la
 * página, el tamaño de los objetivos táctiles (WCAG 2.5.5/2.5.8: 44 px) y, opcional, capturas.
 *
 * `paginaAutenticada` crea su contexto sin viewport propio, así que cada spec lo fija con `fijarCelular(page)`.
 */
const CELULAR = { width: 375, height: 812 } as const;

/** Lado mínimo de un objetivo táctil, en px (el estándar que ya usa el selector de opciones: `min-h-[44px]`). */
const LADO_TACTIL = 44;

export async function fijarCelular(page: Page): Promise<void> {
  await page.setViewportSize(CELULAR);
}

/** Cuánto mide la página por dentro y cuánto se ve: si `scrollWidth` > `clientWidth`, hay scroll horizontal de la PÁGINA entera. */
async function medidasDeDesborde(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
}

/** Falla (con el valor real; `expect.soft`: el spec sigue y reporta TODAS las etapas rotas, no solo la primera) si la página tiene scroll horizontal. Un píxel de tolerancia por el redondeo de las medidas fraccionarias. */
export async function expectSinDesborde(page: Page, donde: string): Promise<void> {
  const { scrollWidth, clientWidth } = await medidasDeDesborde(page);
  expect.soft(scrollWidth, `${donde}: la página se sale por la derecha (scrollWidth ${scrollWidth} sobre clientWidth ${clientWidth})`).toBeLessThanOrEqual(clientWidth + 1);
}

/** Falla si el contenedor tiene contenido cortado por un lado (scroll interno inesperado). */
export async function expectSinDesbordeEn(contenedor: Locator, donde: string): Promise<void> {
  const { scrollWidth, clientWidth } = await contenedor.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect.soft(scrollWidth, `${donde}: el contenido se sale de su caja (scrollWidth ${scrollWidth} sobre clientWidth ${clientWidth})`).toBeLessThanOrEqual(clientWidth + 1);
}

/** Los controles visibles del locator que miden menos de 44 px de alto o de ancho, con su medida (vacío = todos alcanzan). */
async function objetivosChicos(controles: Locator, minimo: { alto?: number; ancho?: number } = {}): Promise<string[]> {
  const alto = minimo.alto ?? LADO_TACTIL;
  const ancho = minimo.ancho ?? LADO_TACTIL;
  const chicos: string[] = [];
  for (const c of await controles.all()) {
    if (!(await c.isVisible())) continue;
    const caja = await c.boundingBox();
    if (!caja) continue;
    if (caja.height + 0.5 < alto || caja.width + 0.5 < ancho) {
      const nombre = (await c.getAttribute("aria-label")) ?? ((await c.innerText()).trim() || (await c.getAttribute("href")) || "?");
      chicos.push(`«${nombre}» ${Math.round(caja.width)}×${Math.round(caja.height)}`);
    }
  }
  return chicos;
}

/** Falla si algún control visible mide menos de 44 px de alto (o de ancho, si se pide). */
export async function expectObjetivosTactiles(controles: Locator, donde: string, minimo: { alto?: number; ancho?: number } = {}): Promise<void> {
  expect.soft(await objetivosChicos(controles, minimo), `${donde}: objetivos táctiles de menos de ${minimo.alto ?? LADO_TACTIL} px`).toEqual([]);
}

/** Guarda una captura en `MOTOR2_CAPTURAS_MOVIL` (carpeta); sin la variable no hace nada. Sirve para revisar a ojo el antes y el después. */
export async function capturar(page: Page, nombre: string): Promise<void> {
  const carpeta = process.env.MOTOR2_CAPTURAS_MOVIL;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  await page.screenshot({ path: join(carpeta, `${nombre}.png`), fullPage: true });
}
