/**
 * MAQUETA «Corregir una factura de compra» por pasos (mismo formato que «Corregir un ticket»): paso 1, buscar (fecha, proveedor, letra, número; resultados abajo) y paso 2, otra página con el original
 * a la izquierda y la copia editable a la derecha. Pantallas reales sobre la compra real de CORDECC y el stock real. Muestra y calcula; NO guarda. Escritorio (1280) y celular (375).
 */
import { abrir, foto } from "./comun";

async function recorrer(ancho: 375 | 1280, sufijo: string) {
  const { navegador, page } = await abrir(ancho);
  await page.goto("http://localhost:3300/reportes/compras/corregir");
  await page.getByRole("heading", { name: "Corregir una factura de compra" }).waitFor();
  await foto(page, `60-factura-paso1-buscar-${sufijo}`);

  // Buscar: proveedor CORDECC, letra A, número 4567
  await page.getByLabel("Proveedor").selectOption({ label: "CORDECC" });
  await page.getByLabel("Letra").selectOption("A");
  await page.getByLabel("N.º de factura").fill("4567");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.locator('[data-factura-resultado="A-00003-00004567"]').waitFor();
  await foto(page, `61-factura-paso1-resultado-${sufijo}`);

  // Elegir → otra página
  await page.getByRole("link", { name: "Corregir →" }).click();
  await page.locator("[data-corregir-factura]").waitFor();
  await foto(page, `62-factura-paso2-original-y-corregida-${sufijo}`);

  // Importe: la cerveza era $150.000
  await page.getByLabel("Un importe (precio)").check();
  await page.getByLabel(/^Importe de Cerveza Patagonia/).fill("150.000");
  await foto(page, `63-factura-paso2-importe-que-cambia-${sufijo}`);

  // Cantidad: bajar a 5 de 24 con 16 en el depósito → límite exacto; a 20 → se puede
  await page.getByLabel("Un importe (precio)").uncheck();
  await page.getByLabel("Una cantidad").check();
  await page.getByLabel(/^Cantidad de Cerveza Patagonia/).fill("5");
  await foto(page, `64-factura-paso2-cantidad-limite-exacto-${sufijo}`);
  await page.getByLabel(/^Cantidad de Cerveza Patagonia/).fill("20");
  await foto(page, `65-factura-paso2-cantidad-que-cambia-${sufijo}`);

  // Completar un importe faltante ($0 = sin dato): una compra real de la base sin precio (el stock inicial de la maqueta)
  await page.goto("http://localhost:3300/reportes/compras/corregir");
  await page.locator("[data-factura-resultado=sin-numero]").first().getByRole("link", { name: "Corregir →" }).click();
  await page.locator("[data-corregir-factura]").waitFor();
  await page.getByLabel("Un importe (precio)").check();
  const campo = page.getByLabel(/^Importe de /).first();
  await campo.fill("1.500");
  await foto(page, `66-factura-paso2-completar-importe-faltante-${sufijo}`);
  await navegador.close();
}

(async () => {
  await recorrer(1280, "escritorio");
  await recorrer(375, "celular");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
