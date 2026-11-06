/**
 * CASO 4: devolución parcial de 6 Cerveza Patagonia con nota de crédito del proveedor. Dos pasos que HOY van por separado (decisión del diseño NC0): (1) la devolución física
 * (pantalla real Movimientos → Devolución a proveedor, baja el stock) y (2) la nota de crédito «solo dinero» (pantalla mínima armada en esta rama, en el detalle de la compra).
 * Importes de EJEMPLO (6 × $6.000 = $36.000; no son costos reales). Corre DESPUÉS de caso-compra-contenedor.ts.
 */
import { abrir, foto, toques } from "./comun";

(async () => {
  const { navegador, page } = await abrir(375);
  const clic = async (destino: ReturnType<typeof page.getByRole>) => {
    toques.clics += 1;
    await destino.click();
  };

  // 1) La devolución física
  await page.goto("http://localhost:3300/movimientos/devolucion-proveedor");
  await page.getByLabel("Depósito *").selectOption({ label: "Depósito" });
  await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "CORDECC" });
  toques.campos += 2;
  await page.getByLabel("N° de factura").fill("A-00003-00004567");
  toques.campos += 1;
  await page.locator('input[placeholder="Código o nombre…"]').first().fill("Cerveza Patagonia");
  await clic(page.getByRole("option", { name: /Cerveza Patagonia/ }).first());
  await page.getByLabel("Cantidad", { exact: false }).first().fill("6");
  await page.getByLabel(/Precio total \(con IVA incluido\)/).first().fill("36000");
  toques.campos += 3;
  await foto(page, "50-devolucion-formulario");
  await clic(page.getByRole("button", { name: "Confirmar", exact: true }));
  await page.getByText(/Se guardaron \d+ movimiento/).first().waitFor();
  await foto(page, "51-devolucion-registrada");

  // 2) La nota de crédito, en el contenedor de la compra
  await page.goto("http://localhost:3300/reportes/compras");
  const tarjeta = page.locator("[data-compra]").first();
  await clic(tarjeta.locator("summary"));
  await clic(tarjeta.getByRole("button", { name: "Cargar nota de crédito del proveedor" }));
  const grupo = tarjeta.getByTestId("numero-de-comprobante");
  await grupo.getByLabel("Punto de venta").fill("1");
  await grupo.getByLabel("Número", { exact: true }).fill("321");
  await tarjeta.getByLabel(/Unidades devueltas de Cerveza Patagonia/).fill("6");
  await tarjeta.getByLabel(/Importe que acredita de Cerveza Patagonia/).fill("36000");
  toques.campos += 4;
  await foto(page, "52-nota-credito-formulario");
  await clic(tarjeta.getByRole("button", { name: "Registrar la nota de crédito" }));
  await tarjeta.getByRole("status").filter({ hasText: "Nota de crédito" }).waitFor();
  await foto(page, "53-nota-credito-registrada");
  await page.reload();
  await page.locator("[data-notas-de-credito]").waitFor();
  await foto(page, "54-nota-credito-en-lista");

  // 3) El mismo reporte en escritorio
  await navegador.close();
  const escritorio = await abrir(1280);
  await escritorio.page.goto("http://localhost:3300/reportes/compras");
  await escritorio.page.locator("[data-notas-de-credito]").waitFor();
  await foto(escritorio.page, "55-nota-credito-en-lista-escritorio");
  await escritorio.page.goto("http://localhost:3300/reportes/devoluciones");
  await foto(escritorio.page, "56-reporte-devoluciones-escritorio");
  await escritorio.navegador.close();
  console.log(`[toques] devolución + nota: ${JSON.stringify(toques)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
