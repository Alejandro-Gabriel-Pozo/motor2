import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarBifeAElegir } from "./fixtures/promo-a-elegir";

/**
 * Promo «a elegir» (etapa N1, PR C; diseño 2026-11-04 §7): «Armar promo» con una entrada que el mozo configura. El mozo elige el plato (Bife), después SUS opciones, y solo ve las que la promo permite hoy
 * (el producto admite «Ojo de bife»; la promo no: no aparece). «Agregar promo» espera a que cada unidad cumpla los mínimos de sus grupos; el precio de la promo es el mismo elija lo que elija ($ 55.000); lo
 * elegido queda congelado en la línea. Celular (375 px) sin desborde horizontal y axe con las opciones abiertas. El servidor (PR A) es la defensa real; esto prueba la comodidad del selector.
 */
const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function abrirArmarPromo(page: Page, d: Awaited<ReturnType<typeof sembrarBifeAElegir>>) {
  await page.goto(`/mesas/${d.mesa.id}`);
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: d.seccion.nombre }).click();
  await page.getByRole("region", { name: d.seccion.nombre }).getByRole("button", { name: d.titulo }).click();
  return page.getByRole("dialog", { name: `Armar «${d.titulo}»` });
}

test("el mozo elige el Bife y sus opciones permitidas: no deja confirmar hasta cumplir los mínimos y cobra el precio fijo de la promo", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const d = await sembrarBifeAElegir(sucursalId, marca);
  try {
    const dialogo = await abrirArmarPromo(page, d);
    const agregarPromo = dialogo.getByRole("button", { name: "Agregar promo" });
    await expect(agregarPromo).toBeDisabled();

    // Elegir el plato suma una unidad con sus grupos; todavía falta lo obligatorio.
    await dialogo.getByRole("button", { name: `Sumar ${d.nombreBife} a Plato principal` }).click();
    const unidad = dialogo.getByRole("group", { name: `Opciones de ${d.nombreBife}` });
    await expect(unidad).toBeVisible();
    await expect(unidad.getByText(`Falta elegir: ${d.grupos.proteina}, ${d.grupos.preparacion}`)).toBeVisible();
    await expect(agregarPromo).toBeDisabled();

    // Solo lo permitido: «Ojo de bife» lo admite el producto pero la promo no lo permite.
    await expect(unidad.getByRole("button", { name: "Nalga" })).toBeVisible();
    await expect(unidad.getByRole("button", { name: "Bife de chorizo" })).toBeVisible();
    await expect(unidad.getByRole("button", { name: "Ojo de bife" })).toHaveCount(0);
    // Sin precios ni adicionales: el precio de la promo es fijo.
    await expect(unidad).not.toContainText("$");

    await unidad.getByRole("button", { name: "Nalga" }).click();
    await expect(agregarPromo).toBeDisabled(); // falta la preparación
    await unidad.getByRole("button", { name: "Bife con chimichurri" }).click();
    await expect(agregarPromo).toBeEnabled(); // las guarniciones son opcionales

    // Elegir otra proteína reemplaza a la anterior (un grupo de una sola elección).
    await unidad.getByRole("button", { name: "Bife de chorizo" }).click();
    await expect(unidad.getByRole("button", { name: "Bife de chorizo" })).toHaveAttribute("aria-pressed", "true");
    await expect(unidad.getByRole("button", { name: "Nalga" })).toHaveAttribute("aria-pressed", "false");
    // Guarniciones: hasta 2.
    await unidad.getByRole("button", { name: "Sumar uno de Puré de papa en " + d.nombreBife }).click();
    await unidad.getByRole("button", { name: "Sumar uno de Papas fritas en " + d.nombreBife }).click();
    await expect(unidad.getByRole("button", { name: "Sumar uno de Ensalada en " + d.nombreBife })).toBeEnabled(); // el tope del grupo lo aplica el reductor: no suma
    await unidad.getByRole("button", { name: "Sumar uno de Ensalada en " + d.nombreBife }).click();
    await expect(unidad.locator('[data-cuantas="Ensalada"]')).toHaveText("0");

    // Accesibilidad con las opciones abiertas.
    const axe = await new AxeBuilder({ page }).include("dialog[open]").analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);

    await agregarPromo.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const linea = page.locator(`[data-promo-por-agregar="${d.titulo}"]`);
    await expect(linea).toContainText(MONEDA.format(55000));
    await page.getByRole("button", { name: "Agregar 1 al pedido", exact: true }).click();
    await expect(page.locator(`[data-promo-sin-enviar="${d.titulo}"]`)).toBeVisible();

    // En la base: la promo cobra $ 55.000 exactos y el Bife lleva congeladas las opciones elegidas.
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId: d.cuenta.id } });
    expect(Number(promoCuenta.precio)).toBe(55000);
    const lineas = await prisma.cuentaItem.findMany({ where: { promoCuentaId: promoCuenta.id }, include: { opcionesElegidas: true } });
    expect(lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precioUnitario), 0)).toBe(55000);
    const bife = lineas.find((l) => l.productoId === d.bifeId)!;
    expect(bife.opcionesElegidas.map((o) => o.nombreOpcion).sort()).toEqual(["Bife con chimichurri", "Bife de chorizo", "Papas fritas", "Puré de papa"].sort());
  } finally {
    await d.limpiar();
  }
});

test("una unidad sin completar bloquea aunque haya otra lista; el plato fijo convive y «−» saca la última unidad", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrarBifeAElegir(sucursalId, `${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
  try {
    const dialogo = await abrirArmarPromo(page, d);
    const agregarPromo = dialogo.getByRole("button", { name: "Agregar promo" });
    await dialogo.getByRole("button", { name: `Sumar ${d.nombreBife} a Plato principal` }).click();
    await dialogo.getByRole("button", { name: `Sumar ${d.nombreBife} a Plato principal` }).click();
    // Máximo del lugar: 2 unidades; no se suma una tercera ni el plato fijo.
    await expect(dialogo.getByRole("group", { name: "Plato principal · 2/2 (mínimo 1)" })).toBeVisible();
    await expect(dialogo.getByRole("button", { name: `Sumar ${d.nombreMilanesa} a Plato principal` })).toBeDisabled();
    const unidades = dialogo.getByRole("group", { name: /^Opciones de / });
    await expect(unidades).toHaveCount(2);
    await unidades.nth(0).getByRole("button", { name: "Nalga" }).click();
    await unidades.nth(0).getByRole("button", { name: "Bife a la criolla" }).click();
    await expect(agregarPromo).toBeDisabled(); // la segunda unidad está incompleta
    await dialogo.getByRole("button", { name: `Restar ${d.nombreBife} de Plato principal` }).click();
    await expect(dialogo.getByRole("group", { name: /^Opciones de / })).toHaveCount(1);
    await expect(agregarPromo).toBeEnabled();
    // La milanesa (configuración fija) se elige como siempre, sin opciones.
    await dialogo.getByRole("button", { name: `Sumar ${d.nombreMilanesa} a Plato principal` }).click();
    await expect(dialogo.getByRole("group", { name: "Plato principal · 2/2 (mínimo 1)" })).toBeVisible();
    await expect(agregarPromo).toBeEnabled();
  } finally {
    await d.limpiar();
  }
});

test("en el celular (375 px) las opciones entran sin desborde horizontal y los botones miden 44 px", async ({ paginaAutenticada: page, sucursalId }) => {
  const d = await sembrarBifeAElegir(sucursalId, `${Date.now()}-${Math.floor(Math.random() * 1e4)}`);
  try {
    await page.setViewportSize({ width: 375, height: 812 });
    const dialogo = await abrirArmarPromo(page, d);
    await dialogo.getByRole("button", { name: `Sumar ${d.nombreBife} a Plato principal` }).click();
    const unidad = dialogo.getByRole("group", { name: `Opciones de ${d.nombreBife}` });
    await expect(unidad).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const alto = await unidad.getByRole("button", { name: "Nalga" }).evaluate((el) => el.getBoundingClientRect().height);
    expect(alto).toBeGreaterThanOrEqual(44);
  } finally {
    await d.limpiar();
  }
});
