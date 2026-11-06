/**
 * CASO 3 (parte 1): la persona carga por la pantalla real «Compra» (5 pasos) la factura de CORDECC con Cerveza Patagonia x24 y Agua 500 cc x48.
 * Los IMPORTES SON DE EJEMPLO (los costos de compra no existen en producción): $144.000 y $72.000. El número de factura se teclea con un error a propósito
 * (A-00003-00004576 en vez de A-00003-00004567) para mostrar después qué sí se puede corregir. La Compra solo ofrece insumos: un PV de reventa se compra como
 * su insumo «<nombre> (reventa)».
 */
import { abrir, foto, toques } from "./comun";

(async () => {
  const { navegador, page } = await abrir(375);
  await page.goto("http://localhost:3300/movimientos/compra");
  const paso = (n: number, titulo: string) => page.getByRole("heading", { name: new RegExp(`^Paso ${n} de 5: ${titulo}$`) }).waitFor();
  const siguiente = async () => {
    toques.clics += 1;
    await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  };

  await paso(1, "Factura");
  await page.locator("select").filter({ has: page.locator("option", { hasText: "CORDECC" }) }).selectOption({ label: "CORDECC" });
  const grupo = page.getByTestId("numero-de-comprobante");
  await grupo.getByLabel("Letra").selectOption({ label: "A" });
  await grupo.getByLabel("Punto de venta").fill("3");
  await grupo.getByLabel("Número", { exact: true }).fill("4576");
  toques.campos += 4;
  await foto(page, "10-compra-paso1-factura");
  await siguiente();
  await paso(2, "Qué compraste");

  const llenarLinea = async (fila: number, insumo: string, cantidad: string, importe: string, referencia: string) => {
    const linea = page.getByTestId("linea-de-compra").nth(fila);
    await linea.locator('input[placeholder="Código o nombre…"]').fill(insumo);
    toques.clics += 1;
    await page.getByRole("option", { name: new RegExp(`${insumo.replace(/[()]/g, "\\$&")}`) }).first().click();
    await linea.locator("label:has-text('Cantidad') input").fill(cantidad);
    await linea.locator("label:has-text('Importe con IVA') input").fill(importe);
    await linea.getByRole("textbox", { name: /Cómo lo llama el proveedor/ }).fill(referencia);
    toques.campos += 4;
  };
  await llenarLinea(0, "Cerveza Patagonia (reventa)", "24", "144000", "Cerveza Patagonia");
  toques.clics += 1;
  await page.getByRole("button", { name: /^\+ Agregar insumo/ }).click();
  await llenarLinea(1, "Agua 500 cc (reventa)", "48", "72000", "Agua 500 cc");
  await foto(page, "11-compra-paso2-renglones");
  await siguiente();

  await paso(3, "Dónde entra");
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Depósito" }) }).first().selectOption({ label: "Depósito" });
  toques.campos += 1;
  await siguiente();
  await paso(4, "Pago");
  await foto(page, "12-compra-paso4-pago");
  await siguiente();
  await paso(5, "Revisar y confirmar");
  await foto(page, "13-compra-paso5-revisar");
  toques.clics += 1;
  await page.getByRole("button", { name: "Confirmar compra", exact: true }).click();
  await page.getByText(/Se guardaron \d+ movimiento/).waitFor();
  await foto(page, "14-compra-confirmada");
  console.log(`[toques] compra: ${JSON.stringify(toques)}`);
  await navegador.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
