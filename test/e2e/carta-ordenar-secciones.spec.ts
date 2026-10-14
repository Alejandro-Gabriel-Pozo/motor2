import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * CARTA-MANT F3 «Ordenar» las secciones (prototipo aprobado; filas O.486 y O.487 de docs/pureza-integracion.md), a 375 px y a 1280 px: en Parametrización › Secciones, «Ordenar», tocar una sección
 * y «Poner acá» antes de otra (la lista es la vista del resultado), «Listo» guarda todo junto, «Deshacer» lo devuelve; «⋯» oculta y muestra una sección. Sin desborde, 44 px en celular y axe 0.
 * Las secciones son de la EMPRESA y la base del CI es compartida: se siembran tres con una marca y orden alto (quedan al final), se mira solo el orden relativo de ellas y al terminar se devuelve
 * cada sección de la empresa a su orden de antes.
 */
async function sembrar() {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const antes = await prisma.seccionCarta.findMany({ select: { id: true, orden: true } });
  const crear = (nombre: string, orden: number) => prisma.seccionCarta.create({ data: { nombre: `${nombre} ${m}`, orden } });
  const a = await crear("E2E Ord Entradas", 90_000);
  const b = await crear("E2E Ord Platos", 90_001);
  const c = await crear("E2E Ord Postres", 90_002);
  return {
    a,
    b,
    c,
    limpiar: async () => {
      await prisma.seccionCarta.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
      for (const x of antes) await prisma.seccionCarta.updateMany({ where: { id: x.id }, data: { orden: x.orden } });
    },
  };
}

async function recorrer(page: Page, d: Awaited<ReturnType<typeof sembrar>>, ancho: "375" | "1280") {
  const mias = async () =>
    (await prisma.seccionCarta.findMany({ where: { id: { in: [d.a.id, d.b.id, d.c.id] } }, orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { nombre: true } })).map((x) => x.nombre);
  const celular = ancho === "375";
  const bloque = page.locator("[data-ordenar-secciones]");
  const aviso = bloque.locator("[data-aviso-orden]");
  const fila = (nombre: string) => bloque.locator(`[data-seccion-orden="${nombre}"]`);

  await page.goto("/carta/parametrizacion/secciones");
  await expect(bloque.getByRole("heading", { name: "Secciones de la carta", level: 2 })).toBeVisible();
  await expect(fila(d.a.nombre)).toBeVisible();
  await expectSinDesborde(page, `Secciones ${ancho} px`);
  await capturar(page, `carta-ordenar-lista-${ancho}`);
  if (celular) await expectObjetivosTactiles(bloque.getByRole("button"), "botones de Secciones");
  expect((await new AxeBuilder({ page }).analyze()).violations, `Secciones a ${ancho} px`).toEqual([]);

  // «Ordenar»: tocar «Postres» y ponerla antes de «Entradas».
  await bloque.getByRole("button", { name: "Ordenar", exact: true }).click();
  await expect(bloque.getByRole("status").first()).toHaveText("Tocá la sección que querés mover y después tocá dónde va. Sin flechas fila por fila.");
  await fila(d.c.nombre).click();
  await expect(fila(d.c.nombre)).toHaveAttribute("aria-pressed", "true");
  await expect(fila(d.c.nombre)).toContainText("Elegida");
  const ponerAntesDeA = bloque.getByRole("button", { name: `Poner acá: «${d.c.nombre}», antes de «${d.a.nombre}»` });
  await fila(d.a.nombre).scrollIntoViewIfNeeded();
  await expectSinDesborde(page, `Ordenar ${ancho} px`);
  await capturar(page, `carta-ordenar-elegida-${ancho}`);
  if (celular) await expectObjetivosTactiles(bloque.getByRole("button"), "botones de Ordenar");
  expect((await new AxeBuilder({ page }).analyze()).violations, `Ordenar a ${ancho} px`).toEqual([]);
  await ponerAntesDeA.click();
  // La lista es la vista del resultado: todavía no se guardó nada.
  await expect(fila(d.c.nombre).locator("xpath=following-sibling::*[1]")).toHaveAttribute("data-seccion-orden", d.a.nombre);
  expect(await mias()).toEqual([d.a.nombre, d.b.nombre, d.c.nombre]);
  await bloque.getByRole("button", { name: "Listo" }).click();
  await expect(aviso.locator("> span")).toHaveText("Listo: las secciones quedaron en el orden nuevo, en todas las sucursales.");
  expect(await mias()).toEqual([d.c.nombre, d.a.nombre, d.b.nombre]);
  await capturar(page, `carta-ordenar-guardado-${ancho}`);

  // «Deshacer»: el orden de antes.
  await aviso.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(mias).toEqual([d.a.nombre, d.b.nombre, d.c.nombre]);

  // «⋯» → ocultar y mostrar.
  await fila(d.b.nombre).getByRole("button", { name: `Opciones de ${d.b.nombre}` }).click();
  const hoja = page.getByRole("dialog", { name: d.b.nombre });
  await expect(hoja.getByRole("button", { name: "Mover de lugar" })).toBeVisible();
  await capturar(page, `carta-ordenar-menu-${ancho}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, `«⋯» a ${ancho} px`).toEqual([]);
  await hoja.getByRole("button", { name: "Ocultar la sección de la carta" }).click();
  await expect(fila(d.b.nombre)).toContainText("Oculta");
  expect((await prisma.seccionCarta.findUniqueOrThrow({ where: { id: d.b.id } })).activa).toBe(false);
  await fila(d.b.nombre).getByRole("button", { name: `Opciones de ${d.b.nombre}` }).click();
  await page.getByRole("dialog", { name: d.b.nombre }).getByRole("button", { name: "Mostrar la sección en la carta" }).click();
  await expect(fila(d.b.nombre)).not.toContainText("Oculta");
}

test("ordenar secciones en celular (375 px): tocar, «Poner acá», «Listo», «Deshacer» y «⋯», sin desborde, 44 px y axe 0", async ({ paginaAutenticada: page }) => {
  test.setTimeout(120_000);
  const d = await sembrar();
  try {
    await fijarCelular(page);
    await recorrer(page, d, "375");
  } finally {
    await d.limpiar();
  }
});

test("ordenar secciones en escritorio (1280 px): lo mismo, sin desborde y axe 0", async ({ paginaAutenticada: page }) => {
  test.setTimeout(120_000);
  const d = await sembrar();
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await recorrer(page, d, "1280");
  } finally {
    await d.limpiar();
  }
});
