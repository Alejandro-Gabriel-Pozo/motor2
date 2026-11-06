/**
 * MAQUETA E0 (rama temporal alegp/tmp-capturas-e0, no se mergea): PR3 por la pantalla REAL.
 * (d) Trazabilidad «Buscar por producto»: una venta de Brownie sale rotulada VENTA (antes salía como CONSUMO).
 * (g) «Corregir este movimiento»: desde una fila de la operación se abre el Ajuste prellenado (producto, sección y referencia al original en el detalle).
 */
import { abrir, foto } from "./comun";

(async () => {
  const { navegador, page } = await abrir(375);
  const aviso = page.locator('[role="status"][aria-live="polite"]');
  // Una venta real de Brownie en el mostrador (mismo recorrido de siempre)
  await page.goto("http://localhost:3300/mesas/mostrador");
  await page.getByRole("button", { name: "Nueva cuenta" }).click();
  await page.getByRole("combobox", { name: "Producto" }).waitFor();
  await page.getByRole("combobox", { name: "Producto" }).fill("Brownie");
  await page.getByRole("option", { name: /Brownie/ }).first().click();
  await page.getByRole("button", { name: /^Agregar \d+ al pedido$/ }).click();
  await aviso.waitFor();
  await page.getByRole("heading", { name: "Sin enviar · 1" }).waitFor();
  await page.getByRole("button", { name: "Enviar a cocina" }).click();
  await page.getByRole("heading", { name: /Envío 1/ }).waitFor();
  await page.getByRole("button", { name: "Cerrar cuenta" }).click();
  await page.getByRole("dialog", { name: /^Cerrar cuenta/ }).getByRole("button", { name: "Cerrar y registrar la venta" }).click();
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();

  // (d) buscar por producto en Trazabilidad
  await page.goto("http://localhost:3300/reportes/trazabilidad");
  await page.getByLabel("Buscar por producto").fill("Brownie");
  await foto(page, "70-trazabilidad-0-buscar-brownie");
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("heading", { name: "Operaciones encontradas" }).waitFor();
  await foto(page, "70-trazabilidad-1-resultado-venta-rotulada");
  const filaVenta = page.locator("tr", { hasText: "VENTA" }).first();
  console.log(`[d] filas con rótulo VENTA: ${await page.locator("tr", { hasText: "VENTA" }).count()}; con CONSUMO: ${await page.locator("tr", { hasText: "CONSUMO" }).count()}`);
  await filaVenta.getByRole("link", { name: /Ver operación/ }).click();

  // (g) la operación y «Corregir este movimiento»
  await page.getByRole("link", { name: /Corregir este movimiento/ }).first().waitFor();
  await foto(page, "71-corregir-movimiento-0-operacion-con-enlace");
  const fila = page.locator("tr", { hasText: "Brownie (reventa)" }).first();
  await fila.getByRole("link", { name: /Corregir este movimiento/ }).click();
  await page.getByText(/Estás corrigiendo un movimiento de/).waitFor();
  await foto(page, "71-corregir-movimiento-1-ajuste-prellenado");
  console.log(`[g] URL del Ajuste: ${page.url().replace(/corrige=.*/, "corrige=<id>")}; detalle: ${await page.getByLabel("Detalle (opcional)").inputValue()}`);
  await navegador.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
