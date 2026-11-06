/**
 * MAQUETA (rama temporal alegp/tmp-capturas-poda-permisos, no se mergea): captura las pantallas REALES «Capacidades por sucursal» y «Matriz de permisos» a 375 px (deviceScaleFactor 2),
 * de página completa, y guarda en `<cuando>-posiciones.json` dónde quedó cada fila de interés (para recortarla, ver recortar.py).
 * Uso: `npx tsx docs/_capturas/poda-permisos/herramientas/capturas.ts antes|despues` contra el servidor `next start` (puerto 3300) y la base local descartable.
 * Antes de capturar apaga, POR LA PANTALLA, la capacidad «alta_producto» en la columna Default (para ver qué dice cada sucursal que no tiene fila propia).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { CARPETA, URL_BASE, abrir, foto } from "./comun";

async function posiciones(page: Page, filas: string[]): Promise<Record<string, [number, number]>> {
  return page.evaluate((claves) => {
    const salida: Record<string, [number, number]> = {};
    for (const tr of Array.from(document.querySelectorAll("tbody tr"))) {
      const primera = tr.querySelector("td");
      const clave = (primera?.querySelector("div.font-medium")?.textContent ?? primera?.textContent ?? "").trim();
      if (claves.includes(clave)) {
        const r = tr.getBoundingClientRect();
        salida[clave] = [r.top + window.scrollY, r.bottom + window.scrollY];
      }
    }
    const cabecera = document.querySelector("thead")?.getBoundingClientRect();
    if (cabecera) salida["__cabecera"] = [cabecera.top + window.scrollY, cabecera.bottom + window.scrollY];
    return salida;
  }, filas);
}

async function main() {
  const cuando = process.argv[2] === "antes" ? "antes" : "despues";
  const { navegador, page } = await abrir(375);
  const pos: Record<string, Record<string, [number, number]>> = {};

  await page.goto(`${URL_BASE}/administracion/capacidades-sucursal`);
  await page.waitForLoadState("networkidle");
  const defecto = page.locator('button[aria-label="alta_producto: valor por defecto"]');
  if ((await defecto.getAttribute("aria-pressed")) === "true") {
    await defecto.click();
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForLoadState("networkidle");
  }
  await foto(page, `capacidades-${cuando}`);
  await page.evaluate(() => { document.querySelector(".overflow-x-auto")!.scrollLeft = 99999; });
  await foto(page, `capacidades-${cuando}-derecha`);
  await page.evaluate(() => { document.querySelector(".overflow-x-auto")!.scrollLeft = 0; });
  pos.capacidades = await posiciones(page, ["activar_usuario_sucursal", "alta_producto", "gestion_permisos", "gestion_usuarios", "compra_recibir", "apagar_cuenta_empresa"]);

  await page.goto(`${URL_BASE}/administracion/permisos`);
  await page.waitForLoadState("networkidle");
  await foto(page, `matriz-${cuando}`);
  await page.evaluate(() => { document.querySelector(".overflow-x-auto")!.scrollLeft = 99999; });
  await foto(page, `matriz-${cuando}-derecha`);
  await page.evaluate(() => { document.querySelector(".overflow-x-auto")!.scrollLeft = 0; });
  pos.matriz = await posiciones(page, ["compra_recibir", "compra_repartir", "reporte_compras", "reporte_conteos", "reporte_consolidado", "reporte_costos"]);

  writeFileSync(path.join(CARPETA, `${cuando}-posiciones.json`), JSON.stringify(pos, null, 1));
  await navegador.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
