import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";
import { anchoDelContenido, columnasDeLaRejilla, dondeSeDesplaza, encabezadoFijo } from "../../src/ui/componentes/estructura/reglas";
import { ORACULO } from "../ui/estructura-de-pantalla.oraculo";

/**
 * Estructura de pantalla (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, etapa E-A) EN EL NAVEGADOR REAL: recorre las combinaciones ancho × menú del oráculo
 * (`test/ui/estructura-de-pantalla.oraculo.ts`) sobre la pestaña «Opciones y precio» de un producto con dos grupos y comprueba quién se desplaza (documento o contenido), si el
 * encabezado del shell queda fijo, cuántas columnas reparte la rejilla y que la página no desborda hacia el costado (celular incluido). También: foco/axe en las dos pantallas de
 * prueba y que al navegar a otra pestaña el contenido vuelve arriba (el scroll ya no es el del documento).
 */
const ALTO = 768;

async function sembrar() {
  const marca = Date.now();
  const tamano = await sembrarGrupo({ nombre: `E2E Estr Tamaño ${marca}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: `T${marca}`, opciones: [{ nombre: "Chico", monto: 0, factorEscala: 1 }, { nombre: "Grande", monto: 500, factorEscala: 2 }] });
  const guarnicion = await sembrarGrupo({ nombre: `E2E Estr Guarnición ${marca}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: `G${marca}`, opciones: [{ nombre: "Papas" }, { nombre: "Puré" }, { nombre: "Ensalada" }] });
  const sucursal = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
  const { productoId } = await sembrarProductoConOpciones({ nombre: `E2E Estr Milanesa ${marca}`, codigo: `PV_E2E_ESTR_${marca}`, precioVenta: 1000, sucursalId: sucursal.id, grupos: [{ grupo: tamano }, { grupo: guarnicion }] });
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `MP_E2E_ESTR_${marca}`, nombre: `E2E Estr Nalga ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.recetaVersion.create({ data: { productoId, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  return { productoId };
}

const COMBINACIONES = ORACULO.filter((f) => [390, 1280, 1366, 1440, 1920].includes(f.ancho));

for (const f of COMBINACIONES) {
  test(`opciones del producto a ${f.ancho} px (menú ${f.menu}): se desplaza ${f.seDesplaza}, rejilla de ${f.columnasDeLaRejilla}`, async ({ paginaAutenticada: page }) => {
    const { productoId } = await sembrar();
    await page.setViewportSize({ width: f.ancho, height: ALTO });
    await page.goto(`/catalogo/productos/${productoId}/opciones`);
    await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
    if (f.menu === "colapsado") await page.getByRole("button", { name: "Ocultar menú" }).click();

    // Regla en el código = tabla del oráculo (las dos fuentes tienen que coincidir antes de mirar el DOM).
    expect(dondeSeDesplaza(f.ancho)).toBe(f.seDesplaza);
    expect(encabezadoFijo(f.ancho)).toBe(f.encabezadoDelShellFijo);
    expect(columnasDeLaRejilla(f.ancho)).toBe(f.columnasDeLaRejilla);
    expect(anchoDelContenido(f.ancho, f.menu === "colapsado" ? "colapsado" : "abierto")).toBe(f.anchoDelContenidoPx);

    const medidas = await page.evaluate(() => {
      const doc = document.documentElement;
      const main = document.querySelector("main")!;
      const grupos = [...document.querySelectorAll("[data-admision-grupo]")];
      return {
        documentoSeDesplaza: doc.scrollHeight > window.innerHeight + 1,
        contenidoSeDesplaza: main.scrollHeight > main.clientHeight + 1,
        desborde: doc.scrollWidth > window.innerWidth + 1,
        columnas: getComputedStyle(grupos[0].parentElement!).gridTemplateColumns.split(" ").length,
      };
    });
    expect(medidas.desborde, "sin desborde horizontal de la página").toBe(false);
    expect(medidas.columnas).toBe(f.columnasDeLaRejilla);
    expect(medidas.documentoSeDesplaza).toBe(f.seDesplaza === "documento");
    expect(medidas.contenidoSeDesplaza).toBe(f.seDesplaza === "contenido");

    // Encabezado del shell: fijo desde md (sigue en y=0 tras desplazar), en celular se va con el documento.
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      if (main.scrollHeight > main.clientHeight + 1 && getComputedStyle(main).overflowY === "auto") main.scrollTop = 300;
      else window.scrollTo(0, 300);
    });
    const arriba = await page.locator("header").first().evaluate((h) => h.getBoundingClientRect().top);
    if (f.encabezadoDelShellFijo) expect(arriba).toBe(0);
    else expect(arriba).toBeLessThan(0);
  });
}

test("al pasar de pestaña el contenido vuelve arriba (el scroll es el del área de contenido) y las dos pantallas de prueba no tienen violaciones de axe", async ({ paginaAutenticada: page }) => {
  const { productoId } = await sembrar();
  await page.setViewportSize({ width: 1366, height: ALTO });
  await page.goto(`/catalogo/productos/${productoId}/opciones`);
  await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "Opciones y precio").toEqual([]);
  await page.evaluate(() => {
    document.querySelector("main")!.scrollTop = 400;
  });
  await page.getByRole("navigation", { name: "Pasos del producto" }).getByRole("link", { name: "Receta" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /versión vigente/ })).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("main")!.scrollTop)).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations, "Receta").toEqual([]);
});

test("sin lugar para dos columnas (1093 px, 1366 con el zoom al 125 %): una columna, sin desborde, encabezado fijo", async ({ paginaAutenticada: page }) => {
  const { productoId } = await sembrar();
  await page.setViewportSize({ width: 1093, height: 614 });
  await page.goto(`/catalogo/productos/${productoId}/opciones`);
  await expect(page.getByRole("heading", { level: 2, name: "Opciones y precio" })).toBeVisible();
  const m = await page.evaluate(() => ({ columnas: getComputedStyle(document.querySelector("[data-admision-grupo]")!.parentElement!).gridTemplateColumns.split(" ").length, desborde: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  expect(m).toEqual({ columnas: 1, desborde: false });
});
