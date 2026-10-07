import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

async function elegirSelectPorOpcion(page: Page, textoOpcion: string) {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}

/**
 * Circuito Movimientos — wizard de Compra por proveedor con alta rápida
 * de producto inline ("+ Nuevo producto"), docs/plan-migracion.md §4.
 * Cubre el fix de QuickCrearProducto (commit 3bf2254): antes, crear el
 * producto inline reseteaba el formulario de Compra entero (proveedor +
 * fila), por el mismo bug de `<form>` anidado que catalogo-alta-
 * producto.spec.ts. Circuito completo: elegir proveedor → alta rápida →
 * completar cantidad/precio → confirmar → verificar en la base que el
 * MovimientoStock quedó bien (no solo que la UI mostró un mensaje).
 */
test("crear producto inline durante una Compra no pisa el proveedor ni la fila, y la compra se registra", async ({ paginaAutenticada: page, seccionId }) => {
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_${Date.now()}`, nombre: `E2E Proveedor ${Date.now()}` } });

  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  await page.goto("/movimientos/compra");

  // Selects por opción visible en vez de por posición — no asume orden
  // (otros specs/datos previos pueden agregar más proveedores/secciones).
  await elegirSelectPorOpcion(page, proveedor.nombre);
  await elegirSelectPorOpcion(page, seccion.nombre);

  await page.getByRole("button", { name: "+ Nuevo producto" }).click();
  const modal = page.locator(".fixed.inset-0");
  const nombreProducto = `E2E Producto Compra ${Date.now()}`;
  await modal.locator("input").first().fill(nombreProducto);
  await modal.locator("select").first().selectOption({ label: "kg" });
  await modal.getByRole("button", { name: "Crear" }).click();

  // El proveedor tiene que seguir seleccionado y la fila mostrar el
  // producto recién creado — antes del fix, los dos se perdían.
  await expect(page.locator('input[placeholder="Código o nombre…"]').first()).toHaveValue(nombreProducto);

  await page.locator("label:has-text('Cantidad') input").first().fill("10");
  await page.locator("label:has-text('Precio total') input").first().fill("1000");
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();

  const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: nombreProducto } });
  const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId } });
  expect(movimiento.proceso).toBe("COMPRA");
  expect(Number(movimiento.cantidad)).toBe(10);
  expect(Number(movimiento.precioTotal)).toBe(1000);
});

/**
 * Bug real que destapó la falla intermitente del test de arriba (en frío, con el servidor lento): si se elige el
 * proveedor y enseguida se abre «+ Nuevo producto», al responder la carga de productos del proveedor la fila se
 * vuelve a montar (cambia su `key`) y el modal abierto desaparece solo, con lo tipeado. Ahora el botón queda
 * deshabilitado mientras esa carga está en curso. Se retrasa la respuesta del servidor para que la ventana sea larga.
 */
test("«+ Nuevo producto» queda deshabilitado mientras se cargan los productos del proveedor", async ({ paginaAutenticada: page, seccionId }) => {
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_${Date.now()}`, nombre: `E2E Proveedor Carga ${Date.now()}` } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  // Ojo: esto retrasa TODOS los POST a esta ruta (cualquier server action de la página: precarga, alta rápida,
  // confirmar). Este test solo dispara la precarga; si se le agrega un paso, cada acción suma 1,5 s.
  await page.route(/\/movimientos\/compra(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") await new Promise((resolver) => setTimeout(resolver, 1500));
    await route.continue();
  });

  await page.goto("/movimientos/compra");
  const nuevoProducto = page.getByRole("button", { name: "+ Nuevo producto", exact: true }).first();
  await expect(nuevoProducto).toBeEnabled();

  // La sección va ANTES que el proveedor: elegir el proveedor arranca el retraso de 1,5 s, y lo que se haga
  // entre ese momento y la aserción de «deshabilitado» se come el margen.
  await elegirSelectPorOpcion(page, seccion.nombre);
  await elegirSelectPorOpcion(page, proveedor.nombre);

  // Mientras la carga está en curso el botón no se puede usar...
  await expect(nuevoProducto).toBeDisabled();
  // ...y cuando responde, el botón ya está en la fila nueva y habilitado.
  await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();
  await expect(nuevoProducto).toBeEnabled();
});

/**
 * Si la carga de productos del proveedor falla: se avisa, se vacían las filas (eran de OTRO proveedor: si se
 * confirmara así, se registraría una compra al proveedor nuevo con los productos y referencias del anterior), los
 * botones no quedan deshabilitados y el selector vuelve a «Sin proveedor» para poder elegir el mismo proveedor de
 * nuevo y reintentar. Se simula la falla abortando el pedido al servidor.
 */
test("si falla la carga de productos del proveedor, se avisa, se vacían las filas y se puede reintentar", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-CP-${ahora}`, nombre: `E2E Producto Prov ${ahora}`, tipo: "MP", unidadStockId: unidad.id, unidadCompraId: unidad.id },
  });
  const proveedorA = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_A_${ahora}`, nombre: `E2E Proveedor Con Productos ${ahora}` } });
  const proveedorB = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_B_${ahora}`, nombre: `E2E Proveedor Falla ${ahora}` } });
  await prisma.proveedorPorProducto.create({
    data: { productoId: producto.id, proveedorId: proveedorA.id, unidadCompraId: unidad.id, precioUnitario: 100, precioPorUnidadStock: 100 },
  });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  // «Ya le comprás» se deriva del Kardex vigente (no de la tabla `ProveedorPorProducto`): hace falta una compra de verdad al proveedor A.
  const usuario = await prisma.user.findFirstOrThrow();
  const compraPrevia = await prisma.operacion.create({ data: { sucursalId: seccion.sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: usuario.id, proveedorId: proveedorA.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compraPrevia.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 100, precioPorUnidadStock: 100 },
  });
  // listarProductosDeProveedor filtra whereDisponibleEn(ctx.sucursalId) (P11) — sin esto no aparece como "ya comprado a este proveedor".
  await prisma.disponibilidadProducto.create({ data: { sucursalId: seccion.sucursalId, productoId: producto.id, disponible: true } });
  const rutaCompra = /\/movimientos\/compra(\?.*)?$/;
  const productoDeLaFila = page.locator('input[placeholder="Código o nombre…"]').first();
  const selectorProveedor = page.locator("select").filter({ has: page.locator("option", { hasText: proveedorA.nombre }) });

  await page.goto("/movimientos/compra");
  await elegirSelectPorOpcion(page, seccion.nombre);

  // Con el proveedor A la carga sale bien y la fila trae su producto.
  await elegirSelectPorOpcion(page, proveedorA.nombre);
  await expect(page.getByText(/1 producto\(s\) que ya le comprás/)).toBeVisible();
  await expect(productoDeLaFila).toHaveValue(new RegExp(producto.nombre));

  // Se corta la conexión con el servidor y se cambia al proveedor B: la carga falla.
  await page.route(rutaCompra, async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });
  await elegirSelectPorOpcion(page, proveedorB.nombre);

  await expect(page.getByText(/No se pudo cargar lo que le comprás a este proveedor/)).toBeVisible();
  await expect(productoDeLaFila).toHaveValue(""); // ya no queda el producto del proveedor A
  await expect(selectorProveedor).toHaveValue("");
  await expect(page.getByRole("button", { name: "+ Nuevo producto", exact: true }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: /\+ Agregar producto/ })).toBeEnabled();

  // Vuelve la conexión: se elige de nuevo el mismo proveedor B y ahora carga.
  await page.unroute(rutaCompra);
  await elegirSelectPorOpcion(page, proveedorB.nombre);
  await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();
  await expect(selectorProveedor).toHaveValue(proveedorB.id);
});

/**
 * Un fallo que llega cuando ya se eligió otro proveedor no pisa lo que se ve ahora: no deselecciona al proveedor
 * nuevo, ni vacía las filas, ni cambia el aviso. Se elige A (su pedido tarda 1,5 s y falla) y enseguida B. Next
 * ejecuta las server actions de a una, así que el pedido de B sale recién cuando el de A terminó: el fallo de A llega
 * con B ya elegido y todavía sin respuesta, y es entonces cuando hay que descartarlo.
 */
test("un fallo tardío de un proveedor anterior no pisa al proveedor elegido después", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const proveedorA = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_TA_${ahora}`, nombre: `E2E Proveedor Lento ${ahora}` } });
  const proveedorB = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_TB_${ahora}`, nombre: `E2E Proveedor Rápido ${ahora}` } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const selectorProveedor = page.locator("select").filter({ has: page.locator("option", { hasText: proveedorA.nombre }) });

  // Los pedidos del proveedor A (se reconocen por su id en el cuerpo) esperan 1,5 s y fallan; el resto pasa normal.
  await page.route(/\/movimientos\/compra(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST" && (route.request().postData() ?? "").includes(proveedorA.id)) {
      await new Promise((resolver) => setTimeout(resolver, 1500));
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto("/movimientos/compra");
  await elegirSelectPorOpcion(page, seccion.nombre);
  await elegirSelectPorOpcion(page, proveedorA.nombre);
  await elegirSelectPorOpcion(page, proveedorB.nombre);
  await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();

  // Espera a que el fallo del proveedor A llegue (1,5 s + margen) y comprueba que no cambió nada.
  await page.waitForTimeout(2500);
  await expect(page.getByText(/No se pudo cargar lo que le comprás/)).toHaveCount(0);
  await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();
  await expect(selectorProveedor).toHaveValue(proveedorB.id);
});

/**
 * Deep-link desde un reporte (ej. «Costo incompleto» → «cargale precio a este insumo»): `/movimientos/compra?productoId=<id>`
 * llega con la primera fila ya cargada con ese producto, mostrado como «CÓDIGO — Nombre» (raya larga), y con el aviso de que se
 * viene de un reporte. La página lo resuelve server-side con obtenerProductoOpcion (Task #41, Fase D6). Se confirma la compra
 * para comprobar que la fila lleva el id del producto, no solo su etiqueta.
 */
test("?productoId= llega con el producto cargado en la fila («CÓDIGO — Nombre») y la compra se registra con ese producto", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-DL-${ahora}`, nombre: `E2E Insumo Deep Link ${ahora}`, tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const etiqueta = `${producto.codigo} — ${producto.nombre}`;

  await page.goto(`/movimientos/compra?productoId=${producto.id}`);

  await expect(page.locator('input[placeholder="Código o nombre…"]').first()).toHaveValue(etiqueta);
  await expect(page.getByText(/Viniste desde un reporte para cargar precio de/)).toContainText(etiqueta);

  await elegirSelectPorOpcion(page, seccion.nombre);
  await page.locator("label:has-text('Cantidad') input").first().fill("3");
  await page.locator("label:has-text('Precio total') input").first().fill("450");
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
  const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId } });
  expect(movimiento.proceso).toBe("COMPRA");
  expect(Number(movimiento.cantidad)).toBe(3);
  expect(Number(movimiento.precioTotal)).toBe(450);
});

/**
 * Validación de datos (docs/plan-validacion-de-datos-2026-09-25.md, Paso C3): el precio total pasa por el parser central. Antes,
 * "...,.,.,..." y "1.000.000" daban NaN y la compra se guardaba con precio 0 sin ningún aviso.
 */
async function prepararCompraDeUnProducto(page: Page, sucursalId: string, seccionId: string) {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-VD-${ahora}`, nombre: `E2E Producto Precio ${ahora}`, tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

  await page.goto("/movimientos/compra");
  await elegirSelectPorOpcion(page, seccion.nombre);
  await page.locator('input[placeholder="Código o nombre…"]').first().fill(producto.nombre);
  await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
  await page.locator("label:has-text('Cantidad') input").first().fill("10");
  return producto;
}

test("un precio '...,.,.,...' no se guarda como 0: el campo lo marca y no se registra nada", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const producto = await prepararCompraDeUnProducto(page, sucursalId, seccionId);
  const precio = page.locator("label:has-text('Precio total') input").first();
  await precio.fill("...,.,.,...");
  await page.getByRole("button", { name: "Confirmar" }).click();

  expect(await precio.evaluate((e: HTMLInputElement) => e.validity.customError), "el precio tiene que quedar inválido").toBe(true);
  expect(await precio.evaluate((e: HTMLInputElement) => e.validationMessage)).toBe("El precio total no es un número válido.");
  await page.waitForTimeout(500); // margen para que un envío que no debió salir llegue a la base
  expect(await prisma.movimientoStock.count({ where: { productoId: producto.id } }), "no tenía que registrarse ninguna compra").toBe(0);
});

test("un precio '1.000.000' (miles en es-AR) se guarda como 1000000", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const producto = await prepararCompraDeUnProducto(page, sucursalId, seccionId);
  await page.locator("label:has-text('Precio total') input").first().fill("1.000.000");
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
  const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, seccionId } });
  expect(Number(movimiento.cantidad)).toBe(10);
  expect(Number(movimiento.precioTotal)).toBe(1_000_000);
});
