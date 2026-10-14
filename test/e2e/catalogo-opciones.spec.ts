import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * GO-2d, pantalla «Opciones de venta» (`/catalogo/opciones`, clave `opciones_definir`): la lista de grupos y el alta. Se siembra y se verifica directo en la base, como los otros
 * specs de catálogo. Cada grupo lleva una marca propia (el nombre es único por empresa). Lo sembrado de opciones NO se borra al terminar: esas tablas solo se agregan (ni el rol de la
 * app ni el de pruebas tienen DELETE, GO-1) y la base E2E se vacía entera al empezar cada corrida.
 */

test("alta de un grupo: tamaño con 1 y 1 fijos, aparece en la lista y queda una sola fila aunque se toque dos veces", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Tamaño ${Date.now()}`;
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("heading", { level: 1, name: "Opciones de venta" })).toBeVisible();
  await page.getByRole("button", { name: "+ Nuevo grupo" }).click();
  await page.getByLabel("Nombre del grupo").fill(nombre);
  await page.getByRole("radio", { name: /^Tamaño/ }).check();
  // Un tamaño se elige siempre una vez: los dos campos quedan fijos en 1.
  await expect(page.getByLabel("Mínimo a elegir")).toHaveValue("1");
  await expect(page.getByLabel("Máximo a elegir")).toHaveValue("1");
  await expect(page.getByLabel("Mínimo a elegir")).toHaveAttribute("readonly", "");
  // Doble clic: la guarda del formulario y la idempotencia del alta dejan una sola fila.
  await page.getByRole("button", { name: "Crear grupo" }).dblclick();
  await expect(page.getByRole("status").filter({ hasText: /creado|ya existía/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: nombre }).first()).toBeVisible();
  const filas = await prisma.grupoDeOpciones.findMany({ where: { nombre }, select: { tipo: true, cantidadMinima: true, cantidadMaxima: true } });
  expect(filas).toEqual([{ tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 }]);
});

test("alta con un nombre que ya existe: el mensaje del servidor queda a la vista y no se crea otro", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Guarnición ${Date.now()}`;
  await prisma.grupoDeOpciones.create({ data: { nombre, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
  await page.goto("/catalogo/opciones");
  await page.getByRole("button", { name: "+ Nuevo grupo" }).click();
  await page.getByLabel("Nombre del grupo").fill(nombre);
  await page.getByRole("radio", { name: /^Variante/ }).check();
  await page.getByRole("button", { name: "Crear grupo" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ya hay un grupo" })).toContainText(`Ya hay un grupo llamado «${nombre}»`);
  // Lo tipeado no se pierde con el error: se corrige y se vuelve a intentar.
  await expect(page.getByLabel("Nombre del grupo")).toHaveValue(nombre);
  expect(await prisma.grupoDeOpciones.count({ where: { nombre } })).toBe(1);
});

test("la lista dice el tipo y los límites en palabras, y cuántos productos usan cada grupo", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Extras ${Date.now()}`;
  await prisma.grupoDeOpciones.create({ data: { nombre, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2 } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/catalogo/opciones");
  const fila = page.getByRole("region", { name: "Grupos de opciones" }).locator("tr", { hasText: nombre });
  await expect(fila).toContainText("Adicional con recargo");
  await expect(fila).toContainText("Opcional · hasta 2");
  // OPCIONES-LIMPIEZA: la tabla es la de los grupos en uso (los archivados van aparte, con «Restaurar»): no hace falta la columna «Estado».
  await expect(page.locator(`[data-grupo-archivado='${nombre}']`)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations, "lista").toEqual([]);
  await page.getByRole("button", { name: "+ Nuevo grupo" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations, "alta abierta").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations, "modo oscuro").toEqual([]);
  // En el celular la tabla se lee como tarjetas, que no se salen de su caja.
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 800 });
  // En el celular el menú lateral ya no se dibuja (MOVIL, O.465: el menú es el cajón del ☰): no hay nada que ocultar para medir la pantalla.
  const tarjetas = page.getByRole("list", { name: "Grupos de opciones" });
  await expect(tarjetas.locator("li", { hasText: nombre })).toContainText("Opcional · hasta 2");
  expect(await tarjetas.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "las tarjetas no se salen de su caja").toBe(true);
});

test("sin la clave `opciones_definir`: el menú no ofrece la pantalla y la URL directa muestra el aviso de permiso", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { producto_ver_catalogo: "ver" });
  try {
    await page.goto("/catalogo/productos");
    await expect(page.getByRole("link", { name: "Productos" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Opciones de venta" })).toHaveCount(0);
    await page.goto("/catalogo/opciones");
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Grupos de opciones" })).toHaveCount(0);
  } finally {
    await limpiar();
  }
});
