import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { completarPasoFactura, confirmarCompra, elegirProductoEnLaFila, irARevisar, llenarLinea, llenarNumeroDeFactura, numeroDeFacturaUnico } from "./fixtures/compra-por-pasos";

/**
 * CAPTURAS para la maqueta de «una sola compra» (U0 + U1): la pantalla REAL del sistema a 375 px, sobre una base local descartable. No es un test: recorre el circuito y guarda PNG en `docs/_capturas/compra-unica/`.
 * Datos: el proveedor CORDECC y los productos Cerveza Patagonia y Agua 500 cc son los del dueño; los IMPORTES son ejemplos y la sucursal («Central») y el depósito son los del entorno de pruebas (ver LEEME.md).
 */
const CARPETA = join(__dirname, "../../docs/_capturas/compra-unica");
mkdirSync(CARPETA, { recursive: true });
test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });

test("capturas de la compra única a 375 px", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const foto = async (nombre: string) => page.screenshot({ path: join(CARPETA, `${nombre}.png`), fullPage: true });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: "CORDECC", nombre: "CORDECC" } });
  const cerveza = await prisma.producto.create({ data: { codigo: "CERV-PATAGONIA", nombre: "Cerveza Patagonia", tipo: "MP", unidadStockId: unidad.id } });
  const agua = await prisma.producto.create({ data: { codigo: "AGUA-500", nombre: "Agua 500 cc", tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.createMany({ data: [cerveza.id, agua.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  async function cargar(producto: string, cantidad: string, importe: string, referencia: string, numero = numeroDeFacturaUnico()) {
    await page.goto("/movimientos/compra");
    await completarPasoFactura(page, { proveedor: "CORDECC", numero });
    // Con historial con el proveedor, el sistema puede traer líneas ya armadas: se carga la ÚLTIMA (la vacía).
    while ((await page.getByTestId("linea-de-compra").count()) > 1) await page.getByTestId("linea-de-compra").first().getByRole("button", { name: "Quitar" }).click();
    const fila = 0;
    await elegirProductoEnLaFila(page, producto, fila);
    await llenarLinea(page, { cantidad, importe, referencia }, fila);
    await irARevisar(page, seccion.nombre);
    return numero;
  }

  // 1. Cargar una compra «pagada ahora» de la sucursal y el mensaje que muestra.
  const nCerveza = await cargar("Cerveza Patagonia", "24", "36000", "Patagonia Amber Lager lata 473");
  await foto("01a-revisar-y-confirmar");
  await confirmarCompra(page);
  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
  await foto("01b-compra-guardada");
  const nAgua = await cargar("Agua 500 cc", "48", "24000", "Agua mineral 500 cc x 6");
  await confirmarCompra(page);
  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();

  // 2. Compras registradas: la compra con factura y sus dos botones.
  await page.goto(`/reportes/compras?proveedorId=${proveedor.id}`);
  const compraCerveza = page.locator("[data-compra]").filter({ hasText: nCerveza.numero });
  const compraAgua = page.locator("[data-compra]").filter({ hasText: nAgua.numero });
  await compraCerveza.locator("summary").click();
  await expect(compraCerveza.getByRole("button", { name: /^Anular compra/ })).toBeVisible();
  await expect(compraCerveza.getByRole("button", { name: /^Corregir proveedor y factura/ })).toBeVisible();
  await foto("02-compras-registradas");

  // 3. Anular con motivo y el resultado.
  await compraCerveza.getByLabel("Motivo de la anulación").fill("Se cargó dos veces");
  await compraCerveza.getByRole("button", { name: /^Anular compra/ }).click();
  await foto("03a-anular-confirmacion");
  await compraCerveza.getByRole("button", { name: "Sí, anular" }).click();
  await expect(compraCerveza.getByRole("status").filter({ hasText: "Factura anulada" })).toBeVisible();
  await foto("03b-anulada");

  // 4. Corregir proveedor/número y el resultado.
  await compraAgua.locator("summary").click();
  await compraAgua.getByRole("button", { name: /^Corregir proveedor y factura/ }).click();
  await foto("04a-corregir-formulario");
  await llenarNumeroDeFactura(compraAgua, numeroDeFacturaUnico());
  await compraAgua.getByRole("button", { name: "Guardar corrección" }).click();
  await expect(compraAgua.getByRole("status").filter({ hasText: "Compra corregida" })).toBeVisible();
  await foto("04b-corregida");

  // 5. El aviso de factura repetida: volver a cargar una factura con un número que ya existe (el de la cerveza anulada queda libre; se usa el corregido del agua).
  const repetido = numeroDeFacturaUnico();
  await cargar("Cerveza Patagonia", "12", "18000", "Patagonia Amber Lager lata 473", repetido);
  await confirmarCompra(page);
  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
  await cargar("Cerveza Patagonia", "12", "18000", "Patagonia Amber Lager lata 473", repetido);
  await confirmarCompra(page);
  await expect(page.getByText(/Ya hay una factura de este proveedor con ese número/)).toBeVisible();
  await foto("05-factura-repetida");
});
