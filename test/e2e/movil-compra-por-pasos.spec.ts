import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";
import {
  completarPasoFactura,
  confirmarCompra,
  elegirProductoEnLaFila,
  elegirSelectPorOpcion,
  llenarLinea,
  sembrarProveedorEInsumo,
  siguiente,
  verPaso,
} from "./fixtures/compra-por-pasos";

/**
 * Compra por pasos en el celular (375 × 812): en CADA uno de los cinco pasos la página no se sale por la derecha (`scrollWidth <= clientWidth`; la fila de la línea de compra es de las más anchas)
 * y, en el paso 5, el botón «Confirmar compra» se puede alcanzar: queda dentro de la pantalla al llevarlo a la vista y no hay ningún otro elemento encima de su centro.
 */
test("celular (375 px): ningún paso de la Compra se sale por la derecha y «Confirmar compra» se alcanza y no está tapado", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(120_000);
  const { proveedor, producto } = await sembrarProveedorEInsumo(prisma, sucursalId, "MOVCP");
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  await fijarCelular(page);
  await page.goto("/movimientos/compra");

  await verPaso(page, 1, "Factura");
  await page.evaluate(() => document.fonts.ready);
  await expectSinDesborde(page, "paso 1 «Factura»");
  await capturar(page, "compra-paso-1");

  await completarPasoFactura(page, { proveedor: proveedor.nombre });
  await elegirProductoEnLaFila(page, producto.nombre);
  await llenarLinea(page, { cantidad: "2", importe: "100", referencia: "Harina celular — código 123 y una descripción larga como la escribe el proveedor en su factura" });
  await expectSinDesborde(page, "paso 2 «Qué compraste»");
  await capturar(page, "compra-paso-2");

  await siguiente(page);
  await verPaso(page, 3, "Dónde entra");
  await elegirSelectPorOpcion(page, seccion.nombre);
  await expectSinDesborde(page, "paso 3 «Dónde entra»");
  await capturar(page, "compra-paso-3");

  await siguiente(page);
  await verPaso(page, 4, "Pago");
  await expectSinDesborde(page, "paso 4 «Pago»");
  await capturar(page, "compra-paso-4");

  await siguiente(page);
  await verPaso(page, 5, "Revisar y confirmar");
  await expectSinDesborde(page, "paso 5 «Revisar y confirmar»");
  await capturar(page, "compra-paso-5");

  const confirmar = page.getByRole("button", { name: "Confirmar compra", exact: true });
  await confirmar.scrollIntoViewIfNeeded();
  await expect(confirmar).toBeVisible();
  await expect(confirmar).toBeInViewport({ ratio: 1 });
  // Nada lo tapa: el elemento que está en el centro del botón es el botón mismo (o algo adentro de él).
  const tapadoPor = await confirmar.evaluate((el) => {
    const caja = el.getBoundingClientRect();
    const encima = document.elementFromPoint(caja.left + caja.width / 2, caja.top + caja.height / 2);
    if (encima && el.contains(encima)) return null;
    return encima ? `<${encima.tagName.toLowerCase()}${encima.id ? `#${encima.id}` : ""}> ${(encima.textContent ?? "").trim().slice(0, 40)}` : "nada (fuera de la pantalla)";
  });
  expect(tapadoPor, "«Confirmar compra» no tiene que estar tapado por otro elemento").toBeNull();
  // Y se puede usar de verdad: confirma la compra.
  await confirmarCompra(page);
  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
});
