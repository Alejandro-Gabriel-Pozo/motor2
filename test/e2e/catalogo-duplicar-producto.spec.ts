import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";
import { expectSinDesborde, fijarCelular } from "./fixtures/movil";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * «Duplicar producto» (E4, docs/diseno-duplicar-producto-2026-11-12.md): el botón de la ficha, el diálogo (nombre obligatorio, qué copiar, el precio, lo que se copia y lo que no) y el flujo del bife: «Bife a criolla»
 * → «Bife con chimichurri», con su receta y sus opciones copiadas y una receta independiente de la del original. Más el doble clic, el celular de 375 px y la accesibilidad del diálogo. Los permisos, la concurrencia, la
 * atomicidad y las combinaciones están en las pruebas de Vitest contra la base (`test/catalogo/duplicar-producto*.test.ts`).
 */
async function sembrarElBife(sucursalId: string, marca: number) {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = async (codigo: string, nombre: string) => {
    const p = await prisma.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: kg.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const carne = await mp(`E2E-DUP-CARNE-${marca}`, `E2E Carne de bife ${marca}`);
  const sal = await mp(`E2E-DUP-SAL-${marca}`, `E2E Sal fina ${marca}`);
  const guarnicion = await sembrarGrupo({
    nombre: `E2E Guarnición ${marca}`,
    tipo: "VARIANTE",
    cantidadMinima: 0,
    cantidadMaxima: 1,
    marca: String(marca),
    opciones: [{ nombre: "Papas fritas", monto: 300 }, { nombre: "Ensalada mixta", monto: 0 }],
  });
  const nombre = `E2E Bife a criolla ${marca}`;
  const { productoId } = await sembrarProductoConOpciones({ nombre, codigo: `E2E-DUP-BIFE-${marca}`, precioVenta: 5000, sucursalId, grupos: [{ grupo: guarnicion }] });
  const receta = await prisma.recetaVersion.create({
    data: {
      productoId,
      version: 1,
      rendimientoCantidad: "1.0000",
      rendimientoUnidadId: kg.id,
      comentarios: "Sellar fuerte",
      ingredientes: {
        create: [
          { insumoProductoId: carne.id, cantidad: "0.3000", unidadId: kg.id, mermaPorcentaje: "5.00" },
          { insumoProductoId: sal.id, cantidad: "0.0100", unidadId: kg.id, mermaPorcentaje: "0" },
        ],
      },
    },
    include: { ingredientes: true },
  });
  const paso = await prisma.recetaPaso.create({ data: { recetaVersionId: receta.id, orden: 1, nombre: "Sellar", instruccion: "Sellar el bife de carne" } });
  await prisma.recetaPasoIngrediente.create({ data: { recetaPasoId: paso.id, recetaIngredienteId: receta.ingredientes.find((i) => i.insumoProductoId === carne.id)!.id } });
  return { productoId, nombre, carne, sal };
}

test("el bife con chimichurri: nombre propio, receta y opciones copiadas, y la receta del duplicado es independiente de la del original", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const bife = await sembrarElBife(sucursalId, marca);
  const nuevoNombre = `E2E Bife con chimichurri ${marca}`;

  await page.goto(`/catalogo/productos/${bife.productoId}`);
  await page.locator("[data-duplicar-producto]").click();
  const dialogo = page.getByRole("dialog", { name: `Duplicar «${bife.nombre}»` });
  await expect(dialogo).toBeVisible();

  // El nombre empieza vacío y es obligatorio; qué copiar viene tildado; con una sola sucursal no se pregunta de cuál sacar la receta.
  const nombre = dialogo.getByRole("textbox", { name: /Nombre del producto nuevo/ });
  await expect(nombre).toHaveValue("");
  await expect(nombre).toBeFocused();
  await expect(dialogo.getByRole("checkbox", { name: "La receta y la ficha técnica" })).toBeChecked();
  await expect(dialogo.getByRole("checkbox", { name: "Las opciones vinculadas" })).toBeChecked();
  await expect(dialogo.getByText("Sacar la receta de")).toHaveCount(0);
  // El precio se muestra, editable (el administrador tiene `producto_campos_sensibles`), con el del original como punto de partida.
  await expect(dialogo.getByRole("textbox", { name: "Precio de venta del producto nuevo" })).toBeVisible();
  // Antes de confirmar dice qué se copia y qué no.
  await expect(dialogo.getByRole("heading", { name: "Lo que se copia y lo que no" })).toBeVisible();
  await expect(dialogo.getByText(/No se copia:.*«En la carta»/)).toBeVisible();

  // Sin nombre no se envía (el campo es obligatorio): no se crea nada.
  await dialogo.locator("[data-confirmar-duplicar]").click();
  await expect(dialogo).toBeVisible();
  expect(await prisma.producto.count({ where: { nombre: nuevoNombre } })).toBe(0);

  await nombre.fill(nuevoNombre);
  await dialogo.locator("[data-confirmar-duplicar]").click();
  await expect(dialogo.getByText(/creado a partir de/)).toBeVisible();
  await expect(dialogo.getByText(/Hay pasos para revisar/)).toBeVisible();
  await expect(dialogo.getByText(/«En la carta» queda pendiente de completar/)).toBeVisible();

  const nuevo = await prisma.producto.findFirstOrThrow({ where: { nombre: nuevoNombre } });
  expect(await prisma.recetaVersion.count({ where: { productoId: nuevo.id } })).toBe(1);
  expect(await prisma.recetaIngrediente.count({ where: { recetaVersion: { productoId: nuevo.id } } })).toBe(2);
  expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: nuevo.id } })).toBe(1);
  expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: nuevo.id } })).toBe(2);
  expect(Number(nuevo.precioVenta)).toBe(5000);

  // Ofrece abrir el producto nuevo: su ficha tiene el nombre propio, y su receta, la copia.
  await dialogo.locator("[data-abrir-duplicado]").click();
  await page.waitForURL(new RegExp(`/catalogo/productos/${nuevo.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(nuevoNombre);
  // Las opciones copiadas se ven en su pestaña «Opciones» (la ficha de Datos ya no las resume).
  await page.goto(`/catalogo/productos/${nuevo.id}/opciones`);
  await expect(page.getByText("Guarnición", { exact: false }).first()).toBeVisible();
  await page.goto(`/catalogo/productos/${nuevo.id}`);

  // Independencia: el original cambia su receta (una versión nueva con otro ingrediente) y la del duplicado sigue como se copió.
  const delOrigen = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: bife.productoId } });
  await prisma.recetaVersion.create({
    data: { productoId: bife.productoId, version: 2, ingredientes: { create: [{ insumoProductoId: bife.sal.id, cantidad: "0.5000", unidadId: bife.sal.unidadStockId, mermaPorcentaje: "0" }] } },
  });
  expect(delOrigen.version).toBe(1);
  await page.goto(`/catalogo/recetas/${nuevo.id}`);
  await expect(page.getByText(bife.carne.nombre).first()).toBeVisible();
  expect(await prisma.recetaVersion.count({ where: { productoId: nuevo.id } })).toBe(1);
  expect(await prisma.recetaIngrediente.count({ where: { recetaVersion: { productoId: nuevo.id } } })).toBe(2);
});

test("doble clic en «Duplicar»: se crea UN solo producto", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const bife = await sembrarElBife(sucursalId, marca);
  const nuevoNombre = `E2E Bife doble clic ${marca}`;
  await page.goto(`/catalogo/productos/${bife.productoId}`);
  await page.locator("[data-duplicar-producto]").click();
  const dialogo = page.getByRole("dialog", { name: /^Duplicar/ });
  await dialogo.getByRole("textbox", { name: /Nombre del producto nuevo/ }).fill(nuevoNombre);
  await dialogo.locator("[data-confirmar-duplicar]").dblclick();
  await expect(dialogo.getByText(/creado a partir de|ya estaba creado/)).toBeVisible();
  expect(await prisma.producto.count({ where: { nombre: nuevoNombre } })).toBe(1);
});

test("un nombre repetido se rechaza dentro del diálogo, que sigue abierto con lo escrito; no se crea nada", async ({ paginaAutenticada: page, sucursalId }) => {
  const bife = await sembrarElBife(sucursalId, Date.now());
  const antes = await prisma.producto.count();
  await page.goto(`/catalogo/productos/${bife.productoId}`);
  await page.locator("[data-duplicar-producto]").click();
  const dialogo = page.getByRole("dialog", { name: /^Duplicar/ });
  await dialogo.getByRole("textbox", { name: /Nombre del producto nuevo/ }).fill(bife.nombre.toUpperCase());
  await dialogo.locator("[data-confirmar-duplicar]").click();
  await expect(dialogo.getByText(/Ya existe un producto llamado/)).toBeVisible();
  await expect(dialogo.getByRole("textbox", { name: /Nombre del producto nuevo/ })).toHaveValue(bife.nombre.toUpperCase());
  expect(await prisma.producto.count()).toBe(antes);
});

test("a 375 px el diálogo no desborda, se puede usar con el dedo y no tiene violaciones de accesibilidad (axe)", async ({ paginaAutenticada: page, sucursalId }) => {
  await fijarCelular(page);
  const bife = await sembrarElBife(sucursalId, Date.now());
  await page.goto(`/catalogo/productos/${bife.productoId}`);
  await expectSinDesborde(page, "ficha del producto con el botón «Duplicar» a 375 px");
  await page.locator("[data-duplicar-producto]").click();
  const dialogo = page.getByRole("dialog", { name: /^Duplicar/ });
  await expect(dialogo).toBeVisible();
  await expectSinDesborde(page, "diálogo «Duplicar» a 375 px");
  const caja = await dialogo.boundingBox();
  expect(caja!.x, "el diálogo no se sale por la izquierda").toBeGreaterThanOrEqual(0);
  expect(caja!.x + caja!.width, "el diálogo no se sale por la derecha").toBeLessThanOrEqual(375 + 1);
  for (const boton of await dialogo.getByRole("button", { name: /^(Cancelar|Duplicar)$/ }).all()) {
    expect((await boton.boundingBox())!.height, "objetivo táctil de 44 px").toBeGreaterThanOrEqual(43);
  }
  const resultados = await new AxeBuilder({ page }).include("dialog[open]").analyze();
  expect(resultados.violations, JSON.stringify(resultados.violations.map((v) => v.id))).toEqual([]);
});

test("con más de una sucursal se ofrece de cuál sacar la receta, con la Central incluida", async ({ browser, baseURL, sucursalId }) => {
  const marca = Date.now();
  const bife = await sembrarElBife(sucursalId, marca);
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto(`/catalogo/productos/${bife.productoId}`);
    await page.locator("[data-duplicar-producto]").click();
    const dialogo = page.getByRole("dialog", { name: /^Duplicar/ });
    const selector = dialogo.getByRole("combobox", { name: "Sacar la receta de" });
    await expect(selector).toBeVisible();
    await expect(selector.getByRole("option", { name: "Central (la receta de toda la empresa)" })).toHaveCount(1);
    await expect(selector.getByRole("option", { name: segunda.nombre })).toHaveCount(1);
  } finally {
    await limpiar();
  }
});
