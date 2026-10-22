import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * Lectura en vivo de la cantidad de un ingrediente (src/core/catalogo/lectura-de-cantidad.ts, src/components/receta/lectura-de-cantidad.tsx): mientras se tipea,
 * el editor de recetas dice qué entendió el sistema («3» → «= 3 kg», «0,30» → «= 300 g»). Lo ambiguo no se adivina (micro-paso 2c): «3.000» da un error junto al campo («¿3,000 o 3000?
 * Escribí 3000 o 3,000.») y la lectura calla. Es solo información: lo que se guarda sigue siendo lo que interpreta el parser (0,30 → 0,3 kg). A 375 px (celular) y a 1280 px, sin desborde y con axe en 0.
 *
 * Datos propios con nombre único (la base del CI es compartida): las búsquedas van acotadas a los campos y a la región de lectura de ESTE formulario.
 */

/** Con `MOTOR2_CAPTURAS_MOVIL` (carpeta), guarda la captura del formulario; sin la variable no hace nada (mismo criterio que `capturar` de fixtures/movil.ts). */
async function capturarFormulario(formulario: Locator, nombre: string): Promise<void> {
  const carpeta = process.env.MOTOR2_CAPTURAS_MOVIL;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  // Con `next dev`, el indicador de desarrollo de Next tapa el pie del formulario en la captura (en producción no existe). La opción `style` la aplica Playwright al capturar: no pasa por la CSP
  // del servidor de producción (`style-src 'self' 'nonce-…'`), que bloquea el `<style>` que agregaría `page.addStyleTag`.
  await formulario.screenshot({ path: join(carpeta, `${nombre}.png`), style: "nextjs-portal { display: none !important; }" });
}

for (const ancho of [375, 1280]) {
  test(`receta: la cantidad de un ingrediente se lee en vivo («= 3 kg», «= 300 g») y «3.000» no se adivina — a ${ancho} px`, async ({ paginaAutenticada: page, sucursalId }) => {
    test.setTimeout(120_000);
    const marca = `${Date.now().toString(36)}${ancho}`; // corta, como un nombre real: una marca larga sin espacios ensancharía la tabla por sí sola
    const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
    // La conversión a «g» solo se muestra si la unidad existe en el catálogo: la siembra base la crea en toda empresa.
    await prisma.unidad.findFirstOrThrow({ where: { nombre: "g", magnitud: "PESO", activa: true } });
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const harina = await prisma.producto.create({ data: { codigo: `E2E-LEC-HARINA-${marca}`, nombre: `E2E Harina lectura ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const huevo = await prisma.producto.create({ data: { codigo: `E2E-LEC-HUEVO-${marca}`, nombre: `E2E Huevo lectura ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
    const sal = await prisma.producto.create({ data: { codigo: `E2E-LEC-SAL-${marca}`, nombre: `E2E Sal lectura ${marca}`, tipo: "MP", unidadStockId: kg.id } });
    const pizza = await prisma.producto.create({ data: { codigo: `E2E-LEC-PIZZA-${marca}`, nombre: `E2E Pizza lectura ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 5000 } });
    await prisma.disponibilidadProducto.createMany({ data: [harina.id, huevo.id, sal.id, pizza.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: sal.id, cantidad: 0.02, unidadId: kg.id }] } },
    });

    await page.setViewportSize({ width: ancho, height: 812 });
    await page.goto(`/catalogo/recetas/${pizza.id}`);
    await page.getByRole("button", { name: "+ Agregar ingrediente", exact: true }).click();
    const formulario = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar ingrediente (genera la próxima versión)" }) });
    const cantidad = formulario.locator("#cantidad-ingrediente-nuevo");
    const lectura = formulario.locator('[data-lectura-de="cantidad-ingrediente-nuevo"]');
    await expect(lectura).toHaveAttribute("aria-live", "polite");

    // Vacío: nada que leer.
    await formulario.getByRole("combobox", { name: "Materia prima", exact: true }).selectOption({ label: `${harina.nombre} (kg)` });
    await expect(lectura).toHaveText("");
    await capturarFormulario(formulario, `receta-lectura-${ancho}-vacio`);

    await cantidad.fill("3");
    await expect(lectura).toContainText("= 3 kg");

    await cantidad.fill("0,30");
    await expect(lectura).toContainText("= 300 g");
    await capturarFormulario(formulario, `receta-lectura-${ancho}-300g`);

    // «3.000» puede ser 3 o tres mil: no se adivina. El campo lo dice junto a sí (error) y la lectura no inventa un número.
    await cantidad.fill("3.000");
    const error = formulario.getByRole("alert").filter({ hasText: "¿3,000 o 3000? Escribí 3000 o 3,000." });
    await expect(error).toBeVisible();
    await expect(cantidad).toHaveAttribute("aria-invalid", "true");
    await expect(lectura).toHaveText("");
    // Al salir del campo se ve lo que se escribió (no se reescribe), y sigue en error.
    await cantidad.blur();
    await expect(cantidad).toHaveValue("3.000");
    await expect(error).toBeVisible();
    await capturarFormulario(formulario, `receta-lectura-${ancho}-ambiguo-3000`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "editor con el error de lo ambiguo a la vista").toEqual([]);
    await expectSinDesborde(page, `receta con el error de lo ambiguo a ${ancho} px`);
    if (ancho === 375) await expectObjetivosTactiles(cantidad, "campo de cantidad en celular", { ancho: 0 });
    // Escribirlo sin ambigüedad lo resuelve: «3000» son tres mil kilos, «3,000» son tres.
    await cantidad.fill("3,000");
    await expect(error).toHaveCount(0);
    await expect(lectura).toContainText("= 3 kg");

    // Otra materia prima, otra unidad: la lectura sigue a la unidad de stock de la elegida.
    await formulario.getByRole("combobox", { name: "Materia prima", exact: true }).selectOption({ label: `${huevo.nombre} (unidad)` });
    await expect(lectura).toContainText("= 3 unidad");

    // Es solo información: no bloquea el envío y lo que se guarda es lo que interpretó el parser (0,30 → 0,3 kg).
    await formulario.getByRole("combobox", { name: "Materia prima", exact: true }).selectOption({ label: `${harina.nombre} (kg)` });
    await cantidad.fill("0,30");
    await expect(lectura).toContainText("= 300 g");
    await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: harina.nombre })).toBeVisible();
    // El formulario se resetea al guardar bien («Materia prima» vuelve a vacío): la lectura deja de hablar en la unidad de la harina.
    await expect(formulario.getByRole("combobox", { name: "Materia prima", exact: true })).toHaveValue("");
    await expect(lectura).not.toContainText(" g");
    const vigente = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pizza.id, sucursalId: null }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    expect(Number(vigente.ingredientes.find((i) => i.insumoProductoId === harina.id)?.cantidad)).toBe(0.3);

    // Editar un ingrediente: lo guardado se lee tal cual; el error de lo ambiguo aparece recién cuando se tipea.
    const sal2 = vigente.ingredientes.find((i) => i.insumoProductoId === sal.id)!;
    await page.goto(`/catalogo/recetas/${pizza.id}?editar=${sal.id}`);
    const lecturaEditar = page.locator(`[data-lectura-de="cantidad-${sal2.id}"]`);
    await expect(lecturaEditar).toHaveText(/= 20 g/);
    await expect(page.getByRole("alert").filter({ hasText: "Escribí" })).toHaveCount(0);
    // Tocar, seleccionar todo y tipear (como la persona). No `fill`: al tomar el foco CampoNumero reemplaza el texto por el que se edita y la selección se pierde.
    const campoEditar = page.locator(`#cantidad-${sal2.id}`);
    await campoEditar.click();
    await campoEditar.press("ControlOrMeta+A");
    await campoEditar.pressSequentially("1.500");
    await expect(campoEditar).toHaveValue("1.500");
    await expect(campoEditar).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert").filter({ hasText: "¿1,500 o 1500? Escribí 1500 o 1,500." })).toBeVisible();
    await capturarFormulario(page.locator("form").filter({ has: campoEditar }), `receta-lectura-${ancho}-editar-ambiguo-1500`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "editar un ingrediente con el error de lo ambiguo").toEqual([]);
    await expectSinDesborde(page, `editar un ingrediente a ${ancho} px`);
  });
}

test("receta propia de la sucursal: el alta de un ingrediente también muestra la lectura", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const harina = await prisma.producto.create({ data: { codigo: `E2E-LEC-RP-HARINA-${marca}`, nombre: `E2E Harina lectura propia ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pizza = await prisma.producto.create({ data: { codigo: `E2E-LEC-RP-PIZZA-${marca}`, nombre: `E2E Pizza lectura propia ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.createMany({ data: [harina.id, pizza.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.3, unidadId: kg.id }] } } });

  await page.goto(`/catalogo/recetas/${pizza.id}`);
  await page.getByRole("button", { name: "Crear receta propia a partir de la central" }).click();
  await expect(page.getByText(/en lugar de la central/)).toBeVisible();
  await page.getByRole("button", { name: "+ Agregar ingrediente a la receta de la sucursal" }).click();
  await page.getByLabel("Materia prima de la receta propia").selectOption({ label: `${harina.nombre} (kg)` });
  const lectura = page.locator('[data-lectura-de="cantidad-ingrediente-nuevo-propia"]');
  await page.locator("#cantidad-ingrediente-nuevo-propia").fill("0,30");
  await expect(lectura).toContainText("= 300 g");
  await page.locator("#cantidad-ingrediente-nuevo-propia").fill("1.500");
  await expect(page.getByRole("alert").filter({ hasText: "¿1,500 o 1500? Escribí 1500 o 1,500." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta de un ingrediente de la receta propia con el error de lo ambiguo").toEqual([]);
});
