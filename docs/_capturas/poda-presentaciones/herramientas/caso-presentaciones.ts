/**
 * MAQUETA (rama temporal alegp/tmp-capturas-poda-presentaciones, no se mergea): capturas a 375 px de las pantallas REALES que cambian al ocultar las presentaciones de compra
 * (interruptor `PRESENTACIONES_VISIBLES`). Uso: `caso-presentaciones.ts antes|despues` contra el servidor `next start` en el puerto 3300, construido con el interruptor en true (antes) o false (despues).
 * Con «antes» se carga además, SOLO PARA MOSTRAR, una presentación de ejemplo «caja ×24» en Cerveza Patagonia (en producción hay 0 presentaciones); «despues» corre sobre la MISMA base, con esa presentación existiendo.
 */
import { prisma } from "../../../../test/e2e/fixtures/db";
import { abrir, foto } from "./comun";

const etiqueta = process.argv[2] === "antes" ? "antes" : "despues";

(async () => {
  const cerveza = await prisma.producto.findFirstOrThrow({ where: { nombre: "Cerveza Patagonia (reventa)" } });
  if (etiqueta === "antes") {
    const caja = (await prisma.unidad.findFirst({ where: { nombre: "caja" } })) ?? (await prisma.unidad.create({ data: { nombre: "caja", decimales: 0 } }));
    const ya = await prisma.presentacion.findFirst({ where: { productoId: cerveza.id, unidadCompraId: caja.id } });
    if (!ya) await prisma.presentacion.create({ data: { productoId: cerveza.id, unidadCompraId: caja.id, factorConversion: 24 } });
  }
  const { navegador, page } = await abrir(375);
  await page.goto(`http://localhost:3300/catalogo/productos/${cerveza.id}/datos`);
  await page.getByRole("heading").first().waitFor();
  await foto(page, `1-${etiqueta}-editar-insumo-cerveza-patagonia`);
  await page.goto(`http://localhost:3300/catalogo/productos/${cerveza.id}`);
  await page.getByRole("heading").first().waitFor();
  await foto(page, `2-${etiqueta}-ficha-insumo-cerveza-patagonia`);

  await page.goto("http://localhost:3300/movimientos/compra");
  await page.getByRole("heading", { name: /^Paso 1 de 5: Factura$/ }).waitFor();
  await page.locator("select").filter({ has: page.locator("option", { hasText: "CORDECC" }) }).selectOption({ label: "CORDECC" });
  const grupo = page.getByTestId("numero-de-comprobante");
  await grupo.getByLabel("Letra").selectOption({ label: "A" });
  await grupo.getByLabel("Punto de venta").fill("3");
  await grupo.getByLabel("Número", { exact: true }).fill("4567");
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
  await page.getByRole("heading", { name: /^Paso 2 de 5: Qué compraste$/ }).waitFor();
  const linea = page.getByTestId("linea-de-compra").nth(0);
  await linea.locator('input[placeholder="Código o nombre…"]').fill("Cerveza Patagonia (reventa)");
  await page.getByRole("option", { name: /Cerveza Patagonia \(reventa\)/ }).first().click();
  await linea.locator("label:has-text('Cantidad') input").fill("24");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await foto(page, `3-${etiqueta}-compra-paso2-cerveza-patagonia`);
  await navegador.close();
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
