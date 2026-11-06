/**
 * MAQUETA del diseño docs/diseno-correccion-de-compras-2026-11-06.md: la pantalla real «Corregir esta factura» sobre la compra real de CORDECC (la de las capturas 40 a 56).
 * Muestra y calcula pero NO guarda. Celular (375) y escritorio (1280). Corre después de correr-todo.sh y con el servidor en el puerto 3300.
 */
import path from "node:path";
import { abrir, foto, CARPETA } from "./comun";

/** Solo el panel de la corrección (la tabla de renglones de la página, que ya existía, ensancha la hoja en el celular). */
async function panel(tarjeta: import("playwright").Locator, selector: string, nombre: string) {
  await tarjeta.locator(selector).screenshot({ path: path.join(CARPETA, `${nombre}.png`) });
  console.log(`[captura] ${nombre}.png`);
}

async function recorrer(ancho: 375 | 1280, sufijo: string) {
  const { navegador, page } = await abrir(ancho);
  await page.goto("http://localhost:3300/reportes/compras");
  const tarjeta = page.locator("[data-compra]").first();
  await tarjeta.waitFor();
  await tarjeta.locator("summary").click();
  await foto(page, `60-corregir-1-contenedor-${sufijo}`);

  await tarjeta.getByRole("button", { name: "Corregir esta factura" }).click();
  await tarjeta.locator("[data-corregir-que]").waitFor();
  await panel(tarjeta, "[data-corregir-que]", `61-corregir-2-que-queres-corregir-${sufijo}`);

  // Caso importe: la cerveza se cargó a $144.000 y era $150.000 (el caso que hoy es un callejón)
  await tarjeta.getByLabel("Un importe (precio) de un renglón").check();
  await tarjeta.getByRole("button", { name: "Seguir" }).click();
  await tarjeta.locator("[data-corregir-editar]").waitFor();
  await panel(tarjeta, "[data-corregir-editar]", `62-corregir-3-original-y-copia-${sufijo}`);
  await tarjeta.getByLabel(/^Importe de Cerveza Patagonia/).fill("150.000");
  await panel(tarjeta, "[data-corregir-editar]", `63-corregir-4-importe-que-cambia-${sufijo}`);

  // Caso cantidad: bajar a 5 de 24 con 16 en el depósito → límite exacto; bajar a 20 → se puede
  await page.reload();
  await tarjeta.locator("summary").click();
  await tarjeta.getByRole("button", { name: "Corregir esta factura" }).click();
  await tarjeta.getByLabel("Una cantidad").check();
  await tarjeta.getByRole("button", { name: "Seguir" }).click();
  await tarjeta.getByLabel(/^Cantidad de Cerveza Patagonia/).fill("5");
  await panel(tarjeta, "[data-corregir-editar]", `64-corregir-5-cantidad-limite-exacto-${sufijo}`);
  await tarjeta.getByLabel(/^Cantidad de Cerveza Patagonia/).fill("20");
  await panel(tarjeta, "[data-corregir-editar]", `65-corregir-6-cantidad-que-cambia-${sufijo}`);
  await navegador.close();
}

(async () => {
  await recorrer(375, "celular");
  await recorrer(1280, "escritorio");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
