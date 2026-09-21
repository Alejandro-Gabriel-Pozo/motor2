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
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
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
  const admin = await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } });
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
