/**
 * MAQUETA (rama temporal alegp/tmp-capturas-e0, no se mergea): utilidades compartidas de los guiones de captura. Cada guion maneja la pantalla REAL del sistema (servidor `next start` de producción
 * contra una base local descartable `motor2_e2e`, ver sembrar-datos-reales.ts) con el navegador Chromium de Playwright y saca las capturas a 375 px (celular) o 1280 px (escritorio), deviceScaleFactor 2.
 */
import "dotenv/config";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const URL_BASE = "http://localhost:3300";
export const CARPETA = path.resolve(__dirname, "..");

/** Cuenta de toques/teclados que hace la persona (clics y campos llenados): la respuesta (a) de cada caso. */
export const toques = { clics: 0, campos: 0 };

export async function abrir(ancho: 375 | 1280): Promise<{ navegador: Browser; contexto: BrowserContext; page: Page }> {
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: ancho === 375 ? 812 : 900 }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  await contexto.addCookies([{ name: "authjs.session-token", value: "maqueta-sesion-gerente", domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  // `window.print()` abriría el diálogo nativo: se reemplaza por un no-op (las impresiones no son lo que se muestra).
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  page.setDefaultTimeout(20_000);
  return { navegador, contexto, page };
}

export async function foto(page: Page, nombre: string, opciones: { completa?: boolean } = {}): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: path.join(CARPETA, `${nombre}.png`), fullPage: opciones.completa ?? true });
  console.log(`[captura] ${nombre}.png`);
}

export async function clic(page: Page, destino: ReturnType<Page["getByRole"]>): Promise<void> {
  toques.clics += 1;
  await destino.click();
}
