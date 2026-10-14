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

/** Los elementos visibles cuyo borde derecho pasa del ancho de la pantalla (los que provocan el scroll horizontal), con su medida: sirve para el mensaje del fallo. */
async function elementosQueSeSalen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ancho = document.documentElement.clientWidth;
    const salen: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0 || caja.right <= ancho + 1) continue;
      // Un elemento dentro de una caja con su propio scroll (una tabla ancha en `overflow-x-auto`) no ensancha la página: se descarta.
      let dentroDeScroll = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden") && p.getBoundingClientRect().right <= ancho + 1) dentroDeScroll = true;
      }
      if (dentroDeScroll) continue;
      const nombre = el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.id ?? "";
      salen.push(`<${el.tagName.toLowerCase()}${nombre ? ` ${nombre}` : ""}> hasta ${Math.round(caja.right)}`);
      if (salen.length >= 6) break;
    }
    return salen;
  });
}

/** Falla (con el valor real y los elementos que se salen; `expect.soft`: el spec sigue y reporta TODAS las etapas rotas, no solo la primera) si la página tiene scroll horizontal. Un píxel de tolerancia por el redondeo de las medidas fraccionarias. */
export async function expectSinDesborde(page: Page, donde: string): Promise<void> {
  const { scrollWidth, clientWidth } = await medidasDeDesborde(page);
  const quienes = scrollWidth > clientWidth + 1 ? ` — se salen: ${(await elementosQueSeSalen(page)).join("; ")}` : "";
  expect.soft(scrollWidth, `${donde}: la página se sale por la derecha (scrollWidth ${scrollWidth} sobre clientWidth ${clientWidth})${quienes}`).toBeLessThanOrEqual(clientWidth + 1);
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

/**
 * El menú lateral fijo de 224 px le deja ~130 px al contenido en el celular: para medir la pantalla y no el menú se lo oculta, como haría la persona
 * (el control «Ocultar menú» existente; la elección queda en el navegador). Sin el botón (ya oculto, o un marco sin menú: el salón), no hace nada.
 */
export async function ocultarMenuSiHaceFalta(page: Page): Promise<void> {
  const ocultar = page.getByRole("button", { name: "Ocultar menú" });
  if (!(await ocultar.isVisible())) return;
  await ocultar.click();
  // El menú se cierra con una transición de ancho (150 ms): se espera a que termine, o se mediría el contenido con el menú todavía a medio cerrar.
  await page.waitForFunction(() => (document.querySelector("aside")?.getBoundingClientRect().width ?? 0) === 0);
}

/** Abre todos los `<details>` de la pantalla (las fichas plegadas de la carta, etc.) para medir también lo que traen adentro. */
export async function abrirTodosLosDetails(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
}

