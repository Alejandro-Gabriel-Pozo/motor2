import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { expectSinDesborde } from "./fixtures/movil";
import { elegirMateriaPrima } from "./fixtures/receta";

/**
 * «Agregar ingrediente» de una receta con el buscador de materias primas (src/components/receta/materia-prima-y-cantidad.tsx, que usa el buscador compartido
 * src/components/selector-producto.tsx): se escribe parte del nombre o del código, cada resultado dice su unidad de stock, al elegir queda la línea de la elegida con «Cambiar» y la unidad
 * pegada a la cantidad. Lo que NO cambia: la receta guardada (misma cantidad, misma unidad de stock) y la validación del servidor.
 *
 * Datos propios con nombre único (la base del CI es compartida): las búsquedas llevan la marca, así que solo encuentran lo sembrado acá.
 */

/** Con `MOTOR2_CAPTURAS_RECETA` (carpeta), guarda la captura; sin la variable no hace nada. Se oculta el indicador de desarrollo de Next, que tapa el pie en `next dev`. */
async function capturar(destino: Locator, nombre: string): Promise<void> {
  const carpeta = process.env.MOTOR2_CAPTURAS_RECETA;
  if (!carpeta) return;
  mkdirSync(carpeta, { recursive: true });
  await destino.screenshot({ path: join(carpeta, `${nombre}.png`), style: "nextjs-portal { display: none !important; }" });
}

async function sembrar(sucursalId: string, marca: string) {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  await prisma.unidad.findFirstOrThrow({ where: { nombre: "g", magnitud: "PESO", activa: true } });
  const tomates = await Promise.all(
    ["A", "B", "C"].map((letra) =>
      prisma.producto.create({ data: { codigo: `E2E-BUS-TOM-${letra}-${marca}`, nombre: `E2E Tomate perita ${marca} Marca ${letra}`, tipo: "MP", unidadStockId: kg.id } }),
    ),
  );
  const huevo = await prisma.producto.create({ data: { codigo: `E2E-BUS-HUEVO-${marca}`, nombre: `E2E Huevo busqueda ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  const sal = await prisma.producto.create({ data: { codigo: `E2E-BUS-SAL-${marca}`, nombre: `E2E Sal busqueda ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pizza = await prisma.producto.create({ data: { codigo: `E2E-BUS-PIZZA-${marca}`, nombre: `E2E Pizza busqueda ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.createMany({ data: [...tomates, huevo, sal, pizza].map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: sal.id, cantidad: 0.02, unidadId: kg.id }] } } });
  return { kg, tomates, huevo, sal, pizza };
}

for (const ancho of [375, 1280]) {
  test(`receta: se busca la materia prima por palabras, cada resultado dice su unidad, se elige y se guarda con la cantidad — a ${ancho} px`, async ({ paginaAutenticada: page, sucursalId }) => {
    test.setTimeout(120_000);
    const marca = `${Date.now().toString(36)}${ancho}`;
    const { kg, tomates, huevo, pizza } = await sembrar(sucursalId, marca);

    await page.setViewportSize({ width: ancho, height: 812 });
    await page.goto(`/catalogo/recetas/${pizza.id}`);
    await page.getByRole("button", { name: "+ Agregar ingrediente", exact: true }).click();
    const formulario = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar ingrediente (genera la próxima versión)" }) });
    const buscador = formulario.getByRole("combobox", { name: "Materia prima", exact: true });

    // Se escribe parte del nombre: aparecen las tres «Tomate perita» y NO el huevo; cada una con la unidad de stock en su resultado.
    await buscador.fill(`perita ${marca}`);
    const resultados = formulario.getByRole("option");
    await expect(resultados).toHaveCount(3);
    for (const [i, tomate] of tomates.entries()) {
      await expect(resultados.nth(i)).toContainText(tomate.nombre);
      await expect(resultados.nth(i)).toContainText(tomate.codigo);
      await expect(resultados.nth(i).locator("span", { hasText: /^kg$/ })).toBeVisible();
    }
    await capturar(formulario, `despues-${ancho}-resultados`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "buscador de materia prima con resultados").toEqual([]);
    await expectSinDesborde(page, `buscador de materia prima abierto a ${ancho} px`);

    // La unidad de CADA materia prima: el huevo se cuenta por «unidad».
    await buscador.fill(`huevo busqueda ${marca}`);
    await expect(resultados).toHaveCount(1);
    await expect(resultados.first().locator("span", { hasText: /^unidad$/ })).toBeVisible();

    // Se elige «Marca B»: queda la línea con su nombre y «Cambiar», y la unidad (kg) pegada a la cantidad.
    await buscador.fill(`perita ${marca}`);
    await expect(resultados).toHaveCount(3);
    await resultados.filter({ hasText: "Marca B" }).click();
    const elegida = formulario.locator("[data-materia-prima-elegida]");
    await expect(elegida).toContainText(tomates[1].nombre);
    await expect(formulario.getByRole("button", { name: "Cambiar materia prima" })).toBeVisible();
    await expect(buscador).toBeHidden();
    await expect(formulario.locator("[data-unidad-de-la-cantidad]")).toHaveText("kg");
    // El foco pasó a la cantidad: se puede tipear de una.
    const cantidad = formulario.locator("#cantidad-ingrediente-nuevo");
    await expect(cantidad).toBeFocused();

    // La lectura en vivo sigue andando con la unidad de la elegida.
    await cantidad.fill("0,25");
    await expect(formulario.locator('[data-lectura-de="cantidad-ingrediente-nuevo"]')).toContainText("= 250 g");
    await capturar(formulario, `despues-${ancho}-elegida`);
    expect((await new AxeBuilder({ page }).analyze()).violations, "materia prima elegida con la unidad pegada a la cantidad").toEqual([]);
    await expectSinDesborde(page, `materia prima elegida a ${ancho} px`);

    // «Cambiar» vuelve al buscador (con el foco y sin la elegida): se elige otra y la unidad cambia con ella.
    await formulario.getByRole("button", { name: "Cambiar materia prima" }).click();
    await expect(buscador).toBeFocused();
    await expect(buscador).toHaveValue("");
    await expect(formulario.locator("[data-unidad-de-la-cantidad]")).toHaveCount(0);
    await expect(formulario.locator("[data-lectura-de='cantidad-ingrediente-nuevo']")).toHaveText("");
    await elegirMateriaPrima(formulario, "Materia prima", huevo.nombre);
    await expect(formulario.locator("[data-unidad-de-la-cantidad]")).toHaveText("unidad");
    await elegirMateriaPrima(formulario, "Materia prima", tomates[1].nombre);
    await expect(formulario.locator("[data-unidad-de-la-cantidad]")).toHaveText("kg");

    // Se guarda: el ingrediente aparece en la receta, con la cantidad y la unidad de stock de la materia prima (lo mismo que cuando era un <select>).
    await cantidad.fill("0,25");
    await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: tomates[1].nombre })).toBeVisible();
    const vigente = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pizza.id, sucursalId: null }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    expect(vigente.version).toBe(2);
    const guardado = vigente.ingredientes.find((i) => i.insumoProductoId === tomates[1].id);
    expect(Number(guardado?.cantidad)).toBe(0.25);
    expect(guardado?.unidadId).toBe(kg.id);
    // El formulario vuelve a empezar: buscador vacío y visible, sin elegida ni unidad.
    await expect(buscador).toBeVisible();
    await expect(buscador).toHaveValue("");
    await expect(formulario.locator("[data-materia-prima-elegida]")).toHaveCount(0);
    await expect(formulario.locator("[data-unidad-de-la-cantidad]")).toHaveCount(0);
  });
}

test("receta: una palabra que no existe dice «No encontré…» y, sin elegir una materia prima, no se envía", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const marca = Date.now().toString(36);
  const { pizza } = await sembrar(sucursalId, marca);

  await page.goto(`/catalogo/recetas/${pizza.id}`);
  await page.getByRole("button", { name: "+ Agregar ingrediente", exact: true }).click();
  const formulario = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar ingrediente (genera la próxima versión)" }) });
  const buscador = formulario.getByRole("combobox", { name: "Materia prima", exact: true });

  await buscador.fill(`zzzinexistente${marca}`);
  const aviso = formulario.getByText(`No encontré «zzzinexistente${marca}». Probá con otra palabra.`);
  await expect(aviso).toBeVisible();
  await expect(formulario.getByRole("option")).toHaveCount(0);
  await capturar(formulario, "despues-sin-resultados");
  expect((await new AxeBuilder({ page }).analyze()).violations, "buscador de materia prima sin resultados").toEqual([]);

  // Sin una materia prima elegida (solo texto suelto) el navegador frena el envío y lo dice en el campo: no se guarda nada.
  await formulario.locator("#cantidad-ingrediente-nuevo").fill("1");
  await formulario.getByRole("button", { name: "Agregar", exact: true }).click();
  expect(await buscador.evaluate((el: HTMLInputElement) => el.validationMessage)).toBe("Elegí una materia prima de la lista.");
  expect(await prisma.recetaVersion.count({ where: { productoId: pizza.id } })).toBe(1);
});

test("receta: apretar «Agregar» dos veces seguidas guarda UNA sola versión", async ({ paginaAutenticada: page, sucursalId }) => {
  test.setTimeout(120_000);
  const marca = Date.now().toString(36);
  const { tomates, pizza } = await sembrar(sucursalId, marca);

  await page.goto(`/catalogo/recetas/${pizza.id}`);
  await page.getByRole("button", { name: "+ Agregar ingrediente", exact: true }).click();
  const formulario = page.locator("form").filter({ has: page.getByRole("heading", { name: "Agregar ingrediente (genera la próxima versión)" }) });
  await elegirMateriaPrima(formulario, "Materia prima", tomates[0].nombre);
  await formulario.locator("#cantidad-ingrediente-nuevo").fill("2");
  await formulario.getByRole("button", { name: "Agregar", exact: true }).dblclick();
  await expect(page.locator("tbody tr").filter({ hasText: tomates[0].nombre })).toBeVisible();
  const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pizza.id, sucursalId: null }, orderBy: { version: "asc" }, include: { ingredientes: true } });
  expect(versiones.map((v) => v.version)).toEqual([1, 2]);
  expect(versiones[1].ingredientes.filter((i) => i.insumoProductoId === tomates[0].id)).toHaveLength(1);
});
