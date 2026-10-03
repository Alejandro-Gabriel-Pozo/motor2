import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * El resultado de una acción tiene que VERSE. Estas pantallas usaban `<form action={async () => { "use server"; await accion(...) }}>`, que hace el
 * `await` y descarta el `ResultadoAccion`: si la acción devolvía `error(...)` (validación, duplicado, permiso), la persona no veía nada y la
 * pantalla parecía no haber reaccionado. Cada caso provoca un error REAL desde la UI y verifica que el mensaje aparece.
 *
 * Son errores que no se pueden ver desde Vitest (que llama a las acciones directo y sí recibe el resultado): lo que se prueba es que la pantalla
 * lo muestre. Los datos van con `Date.now()` y se limpia lo que se cree (varios specs comparten la base dentro de una corrida).
 */

test("categorías: un nombre con caracteres no permitidos muestra el error y no crea nada", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Categoría Inválida ${Date.now()} #!`;

  await page.goto("/catalogo/categorias");
  await expect(page.getByRole("heading", { name: /Categorías/ })).toBeVisible();

  await page.getByPlaceholder("nombre de la categoría").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();

  // Filtrado por texto: Next ya tiene un role="alert" propio y vacío (el anunciador de rutas), así que `getByRole("alert")` a secas matchea dos.
  await expect(page.getByRole("alert").filter({ hasText: "tiene caracteres no permitidos" })).toBeVisible();
  expect(await prisma.categoriaProducto.count({ where: { nombre } }), "no tenía que crearse nada").toBe(0);
});

test("unidades: un nombre repetido muestra el error, y al corregirlo se ve el «creada» junto a la fila nueva", async ({ paginaAutenticada: page }) => {
  const nuevo = `e2eu${Date.now()}`;

  try {
    await page.goto("/catalogo/unidades");
    await expect(page.getByRole("heading", { name: "Unidades de medida" })).toBeVisible();

    // «kg» ya existe en el seed de las pruebas.
    await page.getByPlaceholder("nombre (ej. kg)").fill("kg");
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByText('Ya existe una unidad llamada "kg".')).toBeVisible();

    // Corregido: el ok se ve Y la fila aparece. El mensaje tiene que sobrevivir al refresco de la ruta que pide la acción.
    await page.getByPlaceholder("nombre (ej. kg)").fill(nuevo);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.locator("tr", { hasText: nuevo })).toHaveCount(1);
    await expect(page.getByText(`Unidad "${nuevo}" creada.`)).toBeVisible();
  } finally {
    await prisma.unidad.updateMany({ where: { nombre: nuevo }, data: { activa: false } });
  }
});

test("insumos: un nombre con caracteres no permitidos muestra el error y no crea nada", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Insumo Inválido ${Date.now()} @@`;

  await page.goto("/catalogo/insumos-grupos");
  await expect(page.getByRole("heading", { name: "Insumos", exact: true })).toBeVisible();

  await page.getByPlaceholder("nombre del insumo").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();

  await expect(page.getByText(/tiene caracteres no permitidos/)).toBeVisible();
  expect(await prisma.insumo.count({ where: { nombre } }), "no tenía que crearse nada").toBe(0);
});

test("grupos: poner un grupo como su propio padre muestra el error del ciclo", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Grupo Ciclo ${Date.now()}`;
  const grupo = await prisma.grupo.create({ data: { nombre } });

  try {
    await page.goto("/catalogo/insumos-grupos");
    await expect(page.getByRole("heading", { name: "Árbol de grupos" })).toBeVisible();

    const formulario = page.locator("form", { has: page.getByPlaceholder("nombre del grupo (nuevo o existente)") });
    await formulario.getByPlaceholder("nombre del grupo (nuevo o existente)").fill(nombre);
    await formulario.locator('select[name="grupoPadreId"]').selectOption({ label: nombre });
    await formulario.getByRole("button", { name: "Guardar", exact: true }).click();

    await expect(page.getByText(/crearía un ciclo/)).toBeVisible();
  } finally {
    await prisma.grupo.deleteMany({ where: { id: grupo.id } });
  }
});

test("precio local: un precio inválido muestra el error y la fila no cambia", async ({ paginaAutenticada: page, sucursalId }) => {
  const nombre = `E2E Precio Inválido ${Date.now()}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-PI-${Date.now()}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  // El schema no tiene un check que impida un precio negativo: así se llega al error de la acción desde la tabla.
  await prisma.precioLocalProducto.create({ data: { sucursalId, productoId: producto.id, precio: -1, habilitado: true } });
  const fila = page.locator("tr", { hasText: nombre });

  try {
    await page.goto("/movimientos/precio-local");
    await expect(page.getByRole("heading", { name: /Precio local/ })).toBeVisible();

    await fila.getByRole("button", { name: "Deshabilitar", exact: true }).click();

    await expect(fila.getByText("El precio no puede ser negativo.")).toBeVisible();
    await expect(fila.getByRole("cell", { name: "Sí", exact: true })).toBeVisible();
  } finally {
    await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
  }
});

test("capacidades: si no se pudo cambiar un ✅/⛔ se avisa, y el botón sigue mostrando el estado real", async ({ paginaAutenticada: page }) => {
  const admin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  const where = { rolId: admin.id, accionClave: "capacidades_sucursal" };

  try {
    // En esta pantalla la acción no tiene ningún error de validación alcanzable desde la UI (la matriz excluye la única acción que rechaza), así
    // que se llega al error por el permiso: se le quita «editar» al admin dejando «ver», para que la página siga renderizando.
    await prisma.permisoRol.updateMany({ where, data: { puedeVer: true, puedeEditar: false } });

    await page.goto("/administracion/capacidades-sucursal");
    await expect(page.getByRole("heading", { name: /Capacidades por sucursal/ })).toBeVisible();
    const celda = page.locator("tr", { has: page.getByRole("cell", { name: "stock_minimo", exact: true }) }).locator("td").nth(1); // columna «Default»
    await expect(celda.getByRole("button")).toHaveText("✅");

    await celda.getByRole("button").click();

    await expect(page.getByRole("alert").filter({ hasText: "No tenés permiso para esta acción" })).toBeVisible();
    await expect(celda.getByRole("button"), "el cambio no se hizo: el botón tiene que seguir mostrando ✅").toHaveText("✅");

    // El aviso es fijo en la pantalla y se cierra a mano.
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No tenés permiso para esta acción" })).toHaveCount(0);
  } finally {
    await prisma.permisoRol.updateMany({ where, data: { puedeVer: true, puedeEditar: true } });
  }
});

test("unidades: un campo de decimales vacío no se guarda como 0", async ({ paginaAutenticada: page }) => {
  // Antes: `Number("")` es 0, así que dejar el campo vacío y tocar «Guardar» pasaba la unidad a 0 decimales sin avisar.
  const nombre = `e2ed${Date.now()}`;
  const unidad = await prisma.unidad.create({ data: { nombre, magnitud: "PESO", decimales: 3 } });

  try {
    await page.goto("/catalogo/unidades");
    const entrada = page.locator("tr", { hasText: nombre }).getByLabel(`Decimales de ${nombre}`);
    await expect(entrada).toHaveValue("3");

    await entrada.fill("");
    await page.locator("tr", { hasText: nombre }).getByRole("button", { name: "Guardar", exact: true }).click();

    // El navegador frena el envío (campo obligatorio) y no se toca la base.
    expect(await entrada.evaluate((e: HTMLInputElement) => e.validity.valueMissing), "el campo tiene que ser obligatorio").toBe(true);
    await page.waitForTimeout(500); // margen para que un envío que no debió salir llegue a la base
    expect((await prisma.unidad.findUniqueOrThrow({ where: { id: unidad.id } })).decimales, "los decimales no tenían que cambiar").toBe(3);
  } finally {
    await prisma.unidad.deleteMany({ where: { id: unidad.id } });
  }
});

test("categorías: tras un error el texto tipeado se conserva; tras un éxito el campo se limpia", async ({ paginaAutenticada: page }) => {
  const invalido = `E2E Conserva ${Date.now()} #!`;
  const valido = `E2E Conserva ${Date.now()}`;

  try {
    await page.goto("/catalogo/categorias");
    const campo = page.getByPlaceholder("nombre de la categoría");
    await expect(campo).toBeVisible();

    await campo.fill(invalido);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "tiene caracteres no permitidos" })).toBeVisible();
    // React 19 resetea los campos de un <form action> tras CADA envío: la persona tenía que volver a escribirlo todo para corregir una letra.
    await expect(campo, "el texto tipeado tiene que seguir ahí para corregirlo").toHaveValue(invalido);

    await campo.fill(valido);
    await page.getByRole("button", { name: "Crear", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "creada" })).toBeVisible();
    await expect(campo, "tras un éxito el formulario queda limpio").toHaveValue("");
  } finally {
    await prisma.categoriaProducto.deleteMany({ where: { nombre: valido } });
  }
});

test("precio local: un texto que no es número ('abc') no guarda un precio 0", async ({ paginaAutenticada: page, sucursalId }) => {
  // Antes: CampoNumero borraba todo lo que no fuera dígito ("abc" → ""), el `required` lo cumplía el texto visible y el formulario mandaba
  // `Number("")`, o sea 0. Ahora el campo marca el texto como inválido (validación nativa del navegador) y no sale ningún envío.
  const marca = Date.now();
  const nombre = `E2E Precio Texto ${marca}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-PT-${marca}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });

  try {
    await page.goto("/movimientos/precio-local");
    await expect(page.getByRole("heading", { name: /Precio local/ })).toBeVisible();
    await page.getByRole("combobox").fill(nombre);
    await page.getByRole("option", { name: new RegExp(nombre) }).click();

    const campo = page.getByLabel("Precio local");
    await campo.fill("abc");
    await campo.press("Enter"); // envío implícito, sin sacar el foco del campo
    await page.getByRole("button", { name: "Guardar", exact: true }).click();

    expect(await campo.evaluate((e: HTMLInputElement) => e.validity.customError), "el campo tiene que quedar inválido").toBe(true);
    expect(await campo.evaluate((e: HTMLInputElement) => e.validationMessage)).toMatch(/no es un número válido\./i);
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    await page.waitForTimeout(500); // margen para que un envío que no debió salir llegue a la base
    expect(await prisma.precioLocalProducto.count({ where: { productoId: producto.id } }), "no tenía que guardarse ningún precio").toBe(0);
  } finally {
    await prisma.precioLocalProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
