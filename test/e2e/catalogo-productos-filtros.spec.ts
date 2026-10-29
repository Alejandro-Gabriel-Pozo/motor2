import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * Fase 6, bloque 3, 3b: los filtros de la lista de Productos (`/catalogo/productos`) en el navegador, a 375 y a 1280 px. La búsqueda y los filtros viajan en la URL (formulario GET) y los resuelve el servidor:
 *  - filtrar por tipo y por «le falta algo» deja solo las filas que corresponden, con la URL compartible, y «Limpiar filtros» vuelve a la lista entera;
 *  - Enter en la búsqueda filtra; un valor raro en la URL no rompe nada (la lista sale entera);
 *  - la página siguiente conserva los filtros;
 *  - quien no ve recetas ni carta no tiene esos «le falta» en el selector, y por URL directa el filtro no se aplica (no revela qué productos no tienen receta);
 *  - a 375 px, sin desborde y con los controles de 44 px.
 */

const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function sembrar(m: string, sucursalId: string) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const crear = async (codigo: string, nombre: string, tipo: "PV" | "MP", precioVenta: number) => {
    const p = await prisma.producto.create({ data: { codigo: `E2E-FI-${codigo}-${m}`, nombre: `E2E Filtros ${nombre} ${m}`, tipo, unidadStockId: unidad.id, precioVenta } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const [pizza, sinPrecio, harina] = [await crear("PIZ", "Pizza", "PV", 12000), await crear("SIN", "Sinprecio", "PV", 0), await crear("HAR", "Harina", "MP", 0)];
  return { pizza, sinPrecio, harina, limpiar: () => borrar(m) };
}

async function borrar(m: string) {
  const ids = (await prisma.producto.findMany({ where: { codigo: { startsWith: "E2E-FI-", endsWith: `-${m}` } }, select: { id: true } })).map((p) => p.id);
  await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: ids } } });
  await prisma.producto.deleteMany({ where: { id: { in: ids } } });
}

for (const { ancho, alto } of [
  { ancho: 375, alto: 800 },
  { ancho: 1280, alto: 800 },
]) {
  test.describe(`filtros de la lista de Productos a ${ancho} px`, () => {
    test.beforeEach(async ({ paginaAutenticada: page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
    });

    test("filtrar por tipo y por «le falta algo» deja solo lo que corresponde; «Limpiar filtros» vuelve a todo", async ({ paginaAutenticada: page, sucursalId }) => {
      const m = marca();
      const { pizza, sinPrecio, harina, limpiar } = await sembrar(m, sucursalId);
      try {
        await page.goto(`/catalogo/productos?q=${m}`);
        const filas = page.locator("tbody tr");
        await expect(filas).toHaveCount(3);
        const formulario = page.getByRole("search", { name: "Buscar y filtrar" });
        await expect(formulario).toBeVisible();
        await capturar(page, `filtros-de-productos-${ancho}`);

        await formulario.getByLabel("Tipo").selectOption("materia-prima");
        await formulario.getByRole("button", { name: "Filtrar" }).click();
        await expect(page).toHaveURL(/tipo=materia-prima/);
        await expect(filas).toHaveCount(1);
        await expect(filas.first()).toContainText(harina.nombre);
        // La selección y la búsqueda siguen puestas en los controles después de filtrar.
        await expect(formulario.getByLabel("Tipo")).toHaveValue("materia-prima");
        await expect(formulario.getByLabel(/^Buscar por nombre/)).toHaveValue(m);

        await formulario.getByLabel("Tipo").selectOption("");
        await formulario.getByLabel("Le falta algo").selectOption("sin-precio");
        await formulario.getByRole("button", { name: "Filtrar" }).click();
        await expect(filas).toHaveCount(1);
        await expect(filas.first()).toContainText(sinPrecio.nombre);
        await expect(page.getByText(pizza.nombre)).toHaveCount(0);

        if (ancho === 375) {
          await expectSinDesborde(page, "lista de Productos filtrada a 375 px");
          await expectObjetivosTactiles(formulario.locator("input, select, button"), "controles de los filtros");
        }

        await page.getByRole("link", { name: "Limpiar filtros" }).click();
        await expect(page).toHaveURL(/\/catalogo\/productos$/);
        await expect(formulario.getByLabel("Le falta algo")).toHaveValue("");
        await expect(page.getByRole("link", { name: "Limpiar filtros" })).toHaveCount(0);
      } finally {
        await limpiar();
      }
    });
  });
}

test("Enter en la búsqueda filtra, y un valor raro en la URL no rompe: la lista sale entera", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const { pizza, sinPrecio, harina, limpiar } = await sembrar(m, sucursalId);
  try {
    await page.goto(`/catalogo/productos?q=${m}&tipo=%27%3B+DROP+TABLE&modo=x&disponible=todos&falta=mucho`);
    await expect(page.locator("tbody tr")).toHaveCount(3);
    for (const nombre of ["Tipo", "Cómo se vende", "Disponibilidad", "Le falta algo"]) await expect(page.getByLabel(nombre)).toHaveValue("");
    const busqueda = page.getByLabel(/^Buscar por nombre/);
    await busqueda.fill(`Pizza ${m}`);
    await busqueda.press("Enter");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText(pizza.nombre);
    await expect(page.getByText(sinPrecio.nombre)).toHaveCount(0);
    await expect(page.getByText(harina.nombre)).toHaveCount(0);
  } finally {
    await limpiar();
  }
});

test("la página siguiente conserva los filtros", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const { limpiar } = await sembrar(m, sucursalId);
  try {
    await prisma.producto.createMany({ data: Array.from({ length: 51 }, (_, i) => ({ codigo: `E2E-FI-MP${String(i).padStart(2, "0")}-${m}`, nombre: `E2E Filtros Bulto ${String(i).padStart(2, "0")} ${m}`, tipo: "MP" as const, unidadStockId: unidad.id })) });
    await page.goto(`/catalogo/productos?q=${m}&tipo=materia-prima`);
    // 51 bultos + la harina = 52 materias primas: 50 en la primera página y 2 en la segunda; ningún producto de venta.
    await expect(page.locator("tbody tr")).toHaveCount(50);
    const siguiente = page.getByRole("link", { name: /Página siguiente/ });
    await expect(siguiente).toHaveAttribute("href", /tipo=materia-prima/);
    await siguiente.click();
    await expect(page).toHaveURL(/tipo=materia-prima/);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByText(/E2E Filtros Pizza/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Página siguiente/ })).toHaveCount(0);
  } finally {
    await limpiar();
  }
});

test("PRIVACIDAD: quien no ve recetas ni carta no tiene esos «le falta» y por URL directa el filtro no se aplica; el administrador los ve", async ({ browser, baseURL, paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const { limpiar } = await sembrar(m, sucursalId);
  const { page: paginaDelRol, limpiar: limpiarRol } = await abrirComoRol(browser, baseURL, sucursalId, { producto_ver_catalogo: "ver", alta_producto: "ver" });
  try {
    const consulta = m;
    await paginaDelRol.goto(`/catalogo/productos?q=${consulta}&falta=sin-receta`);
    await expect(paginaDelRol.getByLabel("Le falta algo").locator("option")).toHaveText(["Todos", "Sin precio de venta"]);
    // El filtro por receta no se aplicó (no revela qué productos no tienen receta): están los tres productos, y «Le falta algo» quedó en «Todos».
    await expect(paginaDelRol.locator("tbody tr")).toHaveCount(3);
    await expect(paginaDelRol.getByLabel("Le falta algo")).toHaveValue("");
    await paginaDelRol.goto(`/catalogo/productos?q=${consulta}&falta=fuera-de-la-carta`);
    await expect(paginaDelRol.locator("tbody tr")).toHaveCount(3);

    // Contraespejo: el administrador sí tiene las tres.
    await page.goto(`/catalogo/productos?q=${consulta}`);
    await expect(page.getByLabel("Le falta algo").locator("option")).toHaveText(["Todos", "Sin precio de venta", "Sin receta", "Todavía no está en la carta de esta sucursal"]);
    await page.goto(`/catalogo/productos?q=${consulta}&falta=sin-receta`);
    await expect(page.getByLabel("Le falta algo")).toHaveValue("sin-receta");
    // Los dos productos de venta no tienen receta; la materia prima común no la necesita.
    await expect(page.locator("tbody tr")).toHaveCount(2);
  } finally {
    await limpiarRol();
    await limpiar();
  }
});
