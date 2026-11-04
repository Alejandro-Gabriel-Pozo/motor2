import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Ayudas para recorrer la Compra por pasos (`/movimientos/compra`, etapa 1 de Compras): 1 «Factura», 2 «Qué compraste», 3 «Dónde entra», 4 «Pago», 5 «Revisar y confirmar».
 * El número de factura es obligatorio y ÚNICO: cada llamada a `numeroDeFacturaUnico()` da uno distinto (letra A + punto de venta de 5 dígitos + número de 8), así dos compras de un mismo spec nunca chocan.
 */
export interface NumeroDeFactura {
  letra: string;
  puntoDeVenta: string;
  numero: string;
  /** Como queda guardado: «A-00023-00237728». */
  texto: string;
}

let contador = 0;

export function numeroDeFacturaUnico(): NumeroDeFactura {
  contador += 1;
  const base = Date.now() % 1_000_000_000; // ~11 días en ms: no se repite dentro de una corrida
  const puntoDeVenta = String(((base + contador) % 99_999) + 1).padStart(5, "0");
  const numero = String(((Math.floor(base / 7) * 13 + contador) % 99_999_999) + 1).padStart(8, "0");
  return { letra: "A", puntoDeVenta, numero, texto: `A-${puntoDeVenta}-${numero}` };
}

export async function elegirSelectPorOpcion(page: Page, textoOpcion: string): Promise<void> {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}

/** Los tres campos del número (paso 1 de la Compra, o el formulario «Corregir proveedor y factura» si `donde` es la tarjeta de la compra), sin tocar el proveedor. */
export async function llenarNumeroDeFactura(donde: Page | Locator, numero: NumeroDeFactura): Promise<void> {
  const grupo = donde.getByTestId("numero-de-comprobante");
  await grupo.getByLabel("Letra").selectOption({ label: numero.letra });
  await grupo.getByLabel("Punto de venta").fill(numero.puntoDeVenta);
  await grupo.getByLabel("Número", { exact: true }).fill(numero.numero);
}

export async function siguiente(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Siguiente", exact: true }).click();
}

export async function anterior(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
}

export async function verPaso(page: Page, numero: number, titulo: string): Promise<void> {
  await expect(page.getByRole("heading", { name: new RegExp(`^Paso ${numero} de 5: ${titulo}$`) })).toBeVisible();
}

/** Texto con que termina de cargar lo que se le compra al proveedor (paso 2): con o sin productos ya comprados. */
const CARGA_DEL_PROVEEDOR = /Todavía no le compraste nada a este proveedor|producto\(s\) que ya le comprás/;

/**
 * Paso 1 completo: elige el proveedor, teclea el número (el pasado o uno único) y pasa al paso 2. Devuelve el número de la factura. `fecha` (AAAA-MM-DD) solo si hace falta una distinta de hoy.
 * Con `esperarCarga` (por defecto) deja la pantalla en el paso 2 con la carga de productos del proveedor ya terminada.
 */
export async function completarPasoFactura(
  page: Page,
  opciones: { proveedor: string; numero?: NumeroDeFactura; fecha?: string; esperarCarga?: boolean }
): Promise<NumeroDeFactura> {
  const numero = opciones.numero ?? numeroDeFacturaUnico();
  await verPaso(page, 1, "Factura");
  await elegirSelectPorOpcion(page, opciones.proveedor);
  if (opciones.fecha) await page.getByLabel(/^Fecha de la factura/).fill(opciones.fecha);
  await llenarNumeroDeFactura(page, numero);
  await siguiente(page);
  await verPaso(page, 2, "Qué compraste");
  if (opciones.esperarCarga !== false) await expect(page.getByText(CARGA_DEL_PROVEEDOR)).toBeVisible();
  return numero;
}

/** Elige el producto en la primera línea sin producto (paso 2), tecleando su nombre. */
export async function elegirProductoEnLaFila(page: Page, nombre: string, fila = 0): Promise<void> {
  await page.getByTestId("linea-de-compra").nth(fila).locator('input[placeholder="Código o nombre…"]').fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
}

/** Cantidad, importe y (si es la primera compra del producto a ese proveedor) «cómo lo llama el proveedor» de una línea del paso 2. */
export async function llenarLinea(page: Page, datos: { cantidad: string; importe?: string; referencia?: string }, fila = 0): Promise<void> {
  const linea = page.getByTestId("linea-de-compra").nth(fila);
  await linea.locator("label:has-text('Cantidad') input").fill(datos.cantidad);
  if (datos.importe !== undefined) await linea.locator("label:has-text('Importe con IVA') input").fill(datos.importe);
  if (datos.referencia !== undefined) await linea.getByRole("textbox", { name: /Cómo lo llama el proveedor/ }).fill(datos.referencia);
}

/** Desde el paso 2 (con las líneas completas): elige el depósito en el paso 3 y avanza hasta «Revisar y confirmar». */
export async function irARevisar(page: Page, deposito: string): Promise<void> {
  await siguiente(page);
  await verPaso(page, 3, "Dónde entra");
  await elegirSelectPorOpcion(page, deposito);
  await siguiente(page);
  await verPaso(page, 4, "Pago");
  await siguiente(page);
  await verPaso(page, 5, "Revisar y confirmar");
}

export async function confirmarCompra(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Confirmar compra", exact: true }).click();
}

/** Un proveedor y un insumo (disponible en la sucursal) propios de la prueba, para recorrer la Compra de punta a punta sin depender de otros specs. La base E2E se vacía al terminar la corrida. */
export async function sembrarProveedorEInsumo(
  prisma: typeof import("./db").prisma,
  sucursalId: string,
  prefijo: string
): Promise<{ proveedor: { id: string; nombre: string }; producto: { id: string; codigo: string; nombre: string } }> {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_${prefijo}_${marca}`, nombre: `E2E ${prefijo} Proveedor ${marca}` } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-${prefijo}-${marca}`, nombre: `E2E ${prefijo} Harina ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  return { proveedor, producto };
}
