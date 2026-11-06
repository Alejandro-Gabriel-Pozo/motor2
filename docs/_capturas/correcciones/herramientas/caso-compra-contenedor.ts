/**
 * CASO 3 (parte 2): el CONTENEDOR de la compra en «Compras registradas» (comprobante + renglones + dónde entró el stock), lo único que se puede corregir (la cabecera:
 * el número de factura mal tecleado) y lo que pasa al intentar rehacerla (Anular compra) cuando parte de lo comprado ya se vendió. Celular (375) y escritorio (1280).
 * Corre DESPUÉS de caso-compra.ts y de caso-pos.ts mesa (las 2 cervezas de la Mesa 1 salieron del stock que entró con esta factura).
 */
import { abrir, foto, toques } from "./comun";

async function recorrer(ancho: 375 | 1280, sufijo: string, hacerCorreccion: boolean) {
  const { navegador, page } = await abrir(ancho);
  const clic = async (destino: ReturnType<typeof page.getByRole>) => {
    toques.clics += 1;
    await destino.click();
  };
  await page.goto("http://localhost:3300/reportes/compras");
  const tarjeta = page.locator("[data-compra]").first();
  await tarjeta.waitFor();
  await clic(tarjeta.locator("summary"));
  await foto(page, `40-compra-contenedor-${sufijo}`);

  if (hacerCorreccion) {
    // La trazabilidad de la operación: el movimiento de stock que generó la compra
    await clic(tarjeta.getByRole("link", { name: "ver la operación" }));
    await page.getByRole("heading", { name: /^Operación/ }).waitFor();
    await foto(page, `41-compra-trazabilidad-${sufijo}`);
    await page.goBack();
    await tarjeta.locator("summary").waitFor();
    if (!(await tarjeta.locator("table").isVisible())) await tarjeta.locator("summary").click();

    // Corregir la cabecera: el número tecleado al revés (…4576 → …4567)
    await clic(tarjeta.getByRole("button", { name: /^Corregir proveedor y factura/ }));
    await foto(page, `42-compra-corregir-formulario-${sufijo}`);
    const grupo = tarjeta.getByTestId("numero-de-comprobante");
    await grupo.getByLabel("Letra").selectOption({ label: "A" });
    await grupo.getByLabel("Punto de venta").fill("3");
    await grupo.getByLabel("Número", { exact: true }).fill("4567");
    toques.campos += 1;
    await clic(tarjeta.getByRole("button", { name: "Guardar corrección" }));
    await tarjeta.getByRole("status").filter({ hasText: "Compra corregida" }).waitFor();
    await foto(page, `43-compra-corregida-${sufijo}`);

    // Rehacerla (precio o cantidad mal): Anular compra → rechazado porque parte de lo comprado ya se vendió
    await clic(tarjeta.getByRole("button", { name: /^Anular compra/ }));
    await foto(page, `44-compra-anular-confirmar-${sufijo}`);
    await clic(tarjeta.getByRole("button", { name: "Sí, anular" }));
    await tarjeta.getByRole("alert").first().waitFor();
    await tarjeta.getByRole("alert").filter({ hasText: /stock|devoluci/i }).first().waitFor().catch(() => undefined);
    await foto(page, `45-compra-anular-rechazado-${sufijo}`);
  }
  await navegador.close();
}

(async () => {
  await recorrer(1280, "escritorio", false);
  await recorrer(375, "celular", true);
  console.log(`[toques] compra contenedor: ${JSON.stringify(toques)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
