import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Estructura de pantalla (E-A) × impresión: con `<main>` como el área que se desplaza dentro de un shell del alto de la ventana, el papel tiene que seguir saliendo COMPLETO
 * (si no, se imprimiría solo lo que entra en la primera pantalla). Se emula el medio `print` en Chromium y se genera el PDF A4 de la ficha de cocina de una receta con varios pasos:
 * tiene que salir en UNA hoja, sin menú, sin encabezado, con el último paso. Y a 1366×768 (ventana más baja que la ficha en pantalla) para que el corte se note si el shell lo recortara.
 */
test("la ficha de cocina sale completa en 1 hoja A4 con el shell de alto fijo (sin menú, sin encabezado)", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const pv = await prisma.producto.create({ data: { codigo: `PV_E2E_FICHA_${marca}`, nombre: `E2E Ficha Milanesa ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 1000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: pv.id, disponible: true } });
  const insumos = [];
  for (const n of ["Nalga", "Huevo", "Pan rallado", "Aceite"]) insumos.push(await prisma.producto.create({ data: { codigo: `MP_E2E_FICHA_${n}_${marca}`, nombre: `E2E ${n} ${marca}`, tipo: "MP", unidadStockId: kg.id } }));
  await prisma.recetaVersion.create({
    data: {
      productoId: pv.id,
      version: 1,
      ingredientes: { create: insumos.map((m) => ({ insumoProductoId: m.id, cantidad: 0.22, unidadId: kg.id })) },
      pasos: { create: Array.from({ length: 8 }, (_, i) => ({ orden: i + 1, nombre: `Paso ${i + 1}`, instruccion: `Instrucción del paso ${i + 1}: hacer lo que corresponde con cuidado.`, minutos: 5 })) },
    },
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/catalogo/recetas/${pv.id}/ficha`);
  await expect(page.locator("[data-ficha-cocina]")).toBeVisible();
  // En pantalla: el contenido se desplaza dentro de <main>; el menú y el encabezado están.
  expect(await page.locator("aside").first().isVisible()).toBe(true);

  await page.emulateMedia({ media: "print" });
  const medidas = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const ficha = document.querySelector<HTMLElement>("[data-ficha-cocina]")!;
    const pasos = ficha.querySelectorAll(".ficha-paso");
    const ultimo = pasos[pasos.length - 1] as HTMLElement | undefined;
    return {
      overflowDeMain: getComputedStyle(main).overflowY,
      mainRecortaElContenido: main.scrollHeight > main.clientHeight + 1,
      menuVisible: getComputedStyle(document.querySelector("aside")!).display !== "none",
      encabezadoVisible: getComputedStyle(document.querySelector("header")!).display !== "none",
      ultimoPasoDentroDelDocumento: ultimo ? ultimo.getBoundingClientRect().bottom + window.scrollY <= document.documentElement.scrollHeight + 1 : false,
      cantidadDePasos: pasos.length,
    };
  });
  expect(medidas).toEqual({ overflowDeMain: "visible", mainRecortaElContenido: false, menuVisible: false, encabezadoVisible: false, ultimoPasoDentroDelDocumento: true, cantidadDePasos: 8 });

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  const hojas = (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  expect(hojas, "la ficha sale en una sola hoja A4").toBe(1);
});
