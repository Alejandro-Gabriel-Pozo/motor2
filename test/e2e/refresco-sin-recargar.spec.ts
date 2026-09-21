import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * En esta versión de Next un Server Action que no redirige NO re-renderiza la ruta: la pantalla seguía mostrando los datos viejos en un
 * navegador real hasta recargar a mano (node_modules/next/dist/docs/01-app/02-guides/server-actions.md: "An action that does none of the
 * above ... the current route is not re-rendered"). Vitest no lo ve — llama a las acciones directo desde Node —, por eso este spec vive acá.
 *
 * Cada caso hace la mutación y verifica que la pantalla cambió SIN recargar: se deja una marca en `window` antes de empezar, y si hubiera
 * habido una recarga o una navegación completa, la marca desaparecería. (Una navegación de cliente —`router.refresh()`, el refresco del
 * servidor— no la borra.)
 *
 * Los datos van con `Date.now()` (varios specs comparten la misma base dentro de una corrida) y quedan hasta que `globalTeardown` vacía la
 * base E2E al terminar.
 */
/**
 * /catalogo/insumos-grupos tiene un problema de maquetación REAL a 1280 px (hallazgo de este spec): la tabla de Insumos desborda su columna y
 * el botón «Desactivar» de cada insumo queda TAPADO por la sección de grupos, que intercepta el clic. No es de este cambio y arreglarlo exige una
 * decisión de diseño (¿scroll horizontal o reacomodar columnas?), así que estos casos usan una ventana más ancha para poder probar el refresco.
 * Anotado en docs/pendientes-responsable-2026-09-20.md.
 */
const VENTANA_ANCHA = { width: 1700, height: 900 };
type ConMarca = { __sinRecargar?: boolean };
const ponerMarca = (page: import("@playwright/test").Page) => page.evaluate(() => ((window as unknown as ConMarca).__sinRecargar = true));
const marcaSigue = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as ConMarca).__sinRecargar === true);

test("secciones: crear, desactivar y renombrar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Sección ${Date.now()}`;
  const renombrada = `${nombre} v2`;
  // La fila se identifica por el valor del input del nombre (`defaultValue`, que React deja como atributo `value`).
  const filaDe = (n: string) => page.locator(`tr:has(input[value="${n}"])`);

  await page.goto("/movimientos/secciones");
  await expect(page.getByRole("heading", { name: /Secciones/ })).toBeVisible();
  await ponerMarca(page);

  // Crear: la sección nueva aparece en la tabla.
  await page.getByPlaceholder("nombre de la sección").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(filaDe(nombre)).toHaveCount(1);
  await expect(filaDe(nombre).getByRole("cell", { name: "Sí", exact: true })).toBeVisible();

  // Desactivar: la columna «Activa» pasa a «No» y el botón a «Activar».
  await filaDe(nombre).getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(filaDe(nombre).getByRole("cell", { name: "No", exact: true })).toBeVisible();
  await expect(filaDe(nombre).getByRole("button", { name: "Activar", exact: true })).toBeVisible();

  // Renombrar: la fila pasa a mostrar el nombre nuevo (con el servidor ya normalizado).
  await filaDe(nombre).locator('input[name="nombre"]').fill(renombrada);
  await filaDe(nombre).getByRole("button", { name: "Renombrar", exact: true }).click();
  await expect(filaDe(renombrada)).toHaveCount(1);

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});

test("sucursales: crear y renombrar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const nombre = `E2E Sucursal Refresco ${marca}`;
  const renombrada = `${nombre} v2`;
  const filaDe = (n: string) => page.locator(`tr:has(input[value="${n}"])`);

  try {
    await page.goto("/administracion/sucursales");
    await expect(page.getByRole("heading", { name: "Sucursales", exact: true })).toBeVisible();
    await ponerMarca(page);

    await page.getByPlaceholder("Nombre de la sucursal").fill(nombre);
    await page.getByPlaceholder("Email del primer admin").fill(`e2e-refresco-${marca}@local.test`);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(filaDe(nombre)).toHaveCount(1);

    await filaDe(nombre).locator('input[name="nombre"]').fill(renombrada);
    await filaDe(nombre).getByRole("button", { name: "Renombrar", exact: true }).click();
    await expect(filaDe(renombrada)).toHaveCount(1);

    expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
  } finally {
    // Una sucursal activa de más rompe a otros specs (p. ej. el de Consolidado espera UNA sola): se deja desactivada.
    await prisma.sucursal.updateMany({ where: { nombre: { in: [nombre, renombrada] } }, data: { activo: false } });
  }
});

test("categorías: crear y desactivar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Categoría ${Date.now()}`;
  const fila = page.locator("tr", { hasText: nombre });

  await page.goto("/catalogo/categorias");
  await expect(page.getByRole("heading", { name: /Categorías/ })).toBeVisible();
  await ponerMarca(page);

  await page.getByPlaceholder("nombre de la categoría").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(fila).toHaveCount(1);
  await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();

  // Queda desactivada al terminar: no ensucia los selectores de categoría de otros specs.
  await fila.getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();
  await expect(fila.getByRole("button", { name: "Activar", exact: true })).toBeVisible();

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});

test("unidades: crear, cambiar decimales y desactivar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `e2eu${Date.now()}`;
  const fila = page.locator("tr", { hasText: nombre });

  await page.goto("/catalogo/unidades");
  await expect(page.getByRole("heading", { name: "Unidades de medida" })).toBeVisible();
  await ponerMarca(page);

  await page.getByPlaceholder("nombre (ej. kg)").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(fila).toHaveCount(1);

  // Decimales: el valor guardado se ve en el input (su atributo `value` cambia solo si la pantalla se vuelve a renderizar).
  await fila.locator('input[name="decimales"]').fill("5");
  await fila.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(fila.locator('input[name="decimales"]')).toHaveAttribute("value", "5");

  await fila.getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});

test("insumos: crear y desactivar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Insumo ${Date.now()}`;
  const fila = page.locator(`tr:has(input[value="${nombre}"])`);

  await page.setViewportSize(VENTANA_ANCHA);
  await page.goto("/catalogo/insumos-grupos");
  await expect(page.getByRole("heading", { name: "Insumos", exact: true })).toBeVisible();
  await ponerMarca(page);

  await page.getByPlaceholder("nombre del insumo").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(fila).toHaveCount(1);

  // Queda desactivado al terminar: no ensucia los selectores de insumo de otros specs.
  await fila.getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});

test("grupos: crear y desactivar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Grupo ${Date.now()}`;
  // El «Guardar» del formulario de grupos se distingue de los «Guardar» de cada fila de insumos por el formulario que lo contiene.
  const formularioDeGrupo = page.locator("form", { has: page.getByPlaceholder("nombre del grupo (nuevo o existente)") });
  const fila = page.locator("tr", { has: page.getByRole("cell", { name: nombre, exact: true }) });

  await page.setViewportSize(VENTANA_ANCHA);
  await page.goto("/catalogo/insumos-grupos");
  await expect(page.getByRole("heading", { name: "Árbol de grupos" })).toBeVisible();
  await ponerMarca(page);

  await page.getByPlaceholder("nombre del grupo (nuevo o existente)").fill(nombre);
  await formularioDeGrupo.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(fila).toHaveCount(1);
  await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();

  await fila.getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});

test("insumos: fusionar uno con otro hace desaparecer la fila del absorbido sin recargar", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const absorbido = `E2E Insumo Absorbido ${marca}`;
  const destino = `E2E Insumo Destino ${marca}`;
  await prisma.insumo.create({ data: { nombre: absorbido } });
  await prisma.insumo.create({ data: { nombre: destino } });

  await page.setViewportSize(VENTANA_ANCHA);
  await page.goto("/catalogo/insumos-grupos");
  await expect(page.getByRole("heading", { name: "Insumos", exact: true })).toBeVisible();
  await ponerMarca(page);

  // La fila se toma UNA vez como elemento: al tipear, el input es controlado y el atributo `value` no es una referencia estable.
  const filaAbsorbido = await page.locator(`tr:has(input[value="${absorbido}"])`).elementHandle();
  expect(filaAbsorbido, "no apareció la fila del insumo a fusionar").not.toBeNull();
  await (await filaAbsorbido!.$("input"))!.fill(destino);
  await (await filaAbsorbido!.$("button"))!.click(); // «Renombrar/fusionar»
  await page.getByRole("button", { name: "Sí, fusionar", exact: true }).click();

  // 1) Primero se espera a que la fusión TERMINE en la base (mientras corre, la fila muestra la confirmación en lugar del input, y mirar la
  //    pantalla antes daría un falso resultado).
  await expect.poll(() => prisma.insumo.count({ where: { nombre: absorbido } }), { message: "el insumo absorbido tiene que haberse borrado" }).toBe(0);
  // 2) Recién ahí, la pantalla: tras fusionar hay UNA sola fila con el nombre destino. Sin refresco, la fila del absorbido sigue mostrando ese
  //    mismo nombre (su input es controlado y conserva lo tipeado).
  await expect
    .poll(() => page.locator("input").evaluateAll((els, v) => els.filter((e) => (e as HTMLInputElement).value === v).length, destino), {
      message: "la fila del insumo absorbido sigue en pantalla",
    })
    .toBe(1);
  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco").toBe(true);

  // Deja el destino desactivado: no ensucia a otros specs.
  await prisma.insumo.updateMany({ where: { nombre: destino }, data: { activo: false } });
});

test("capacidades por sucursal: el ✅/⛔ cambia sin recargar la página (y solo se toca la columna de una sucursal propia)", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Sucursal Capacidad ${Date.now()}`;
  // Sucursal propia y activa (la matriz lista solo las activas): así no se toca la columna «Default», que es global y compartida con otros specs.
  await prisma.sucursal.create({ data: { nombre } });

  try {
    await page.goto("/administracion/capacidades-sucursal");
    await expect(page.getByRole("heading", { name: /Capacidades por sucursal/ })).toBeVisible();
    await ponerMarca(page);

    // La columna de la sucursal propia: el índice de su <th> es el del <td> de cada fila.
    const columnas = await page.locator("thead th").allTextContents();
    const indice = columnas.findIndex((t) => t.trim() === nombre);
    expect(indice, "no apareció la columna de la sucursal propia").toBeGreaterThan(1);
    const celda = page.locator("tr", { has: page.getByRole("cell", { name: "stock_minimo", exact: true }) }).locator("td").nth(indice);

    // Sin ninguna fila, la acción está habilitada; «el botón ES el estado», así que si no se refresca queda mostrando el estado viejo.
    await expect(celda.getByRole("button")).toHaveText("✅");
    await celda.getByRole("button").click();
    await expect(celda.getByRole("button")).toHaveText("⛔");
    await celda.getByRole("button").click();
    await expect(celda.getByRole("button")).toHaveText("✅");

    expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
  } finally {
    // Una sucursal activa de más rompe a otros specs (p. ej. el de Consolidado espera UNA sola): se deja desactivada.
    await prisma.sucursal.updateMany({ where: { nombre }, data: { activo: false } });
  }
});

test("precio local: habilitar y deshabilitar un precio de la tabla se ve sin recargar la página", async ({ paginaAutenticada: page, sucursalId }) => {
  const nombre = `E2E Precio Local ${Date.now()}`;
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-PL-${Date.now()}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: producto.id, precio: 50, habilitado: true } });
  const fila = page.locator("tr", { hasText: nombre });

  try {
    await page.goto("/movimientos/precio-local");
    await expect(page.getByRole("heading", { name: /Precio local/ })).toBeVisible();
    await ponerMarca(page);

    await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();
    await fila.getByRole("button", { name: "Deshabilitar", exact: true }).click();
    await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible();
    await expect(fila.getByRole("button", { name: "Habilitar", exact: true })).toBeVisible();

    expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
  } finally {
    // Un precio local suelto cambiaría los márgenes de otros specs de esa sucursal: se borra.
    await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
  }
});
