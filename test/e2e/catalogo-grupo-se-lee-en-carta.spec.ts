import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo } from "./fixtures/opciones";

/**
 * Fase 4 de la ola «precio y carta» (ADR-035, DEC-34): «Se lee en la carta como» en la pantalla de un grupo (`/catalogo/opciones/[grupoId]`): escribir «De» y ver la lectura en vivo, guardar y recargar,
 * vaciar (vuelve a NULL), el rechazo de espacios a los costados, dos pestañas («cambió mientras lo editabas»), que no aparece en una INCLUIDA, y axe a 1280 y a 375 px. La carta pública todavía no lo
 * muestra (Fase 5). Lo sembrado no se borra.
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const campo = (page: import("@playwright/test").Page) => page.getByLabel("Se lee en la carta como");
const lectura = (page: import("@playwright/test").Page) => page.locator("[data-lectura-en-carta]");

for (const ancho of [1280, 375]) {
  test(`a ${ancho} px: escribir «De», la lectura en vivo, guardar, recargar y vaciar`, async ({ paginaAutenticada: page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const m = marca();
    const g = await sembrarGrupo({ nombre: `E2E Milanesas de ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Carne" }, { nombre: "Pollo" }, { nombre: "Trucha" }] });
    await page.goto(`/catalogo/opciones/${g.grupoId}`);
    await expect(lectura(page)).toHaveText("Sin prefijo: cada opción se lee con su nombre.");
    await expect(lectura(page)).toHaveAttribute("aria-live", "polite");
    await campo(page).fill("De");
    await expect(lectura(page)).toHaveText("En la carta se verá: De carne · De pollo · De trucha");
    await expect(page.getByText("(2/20)")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "con la lectura en vivo").toEqual([]);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    await page.reload();
    await expect(campo(page)).toHaveValue("De");
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId }, select: { prefijoEnCarta: true, version: true } })).toEqual({ prefijoEnCarta: "De", version: 2 });

    await campo(page).fill("");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId }, select: { prefijoEnCarta: true } })).prefijoEnCarta).toBeNull();
    expect(await prisma.registroAuditoria.count({ where: { entidad: "GrupoDeOpciones", entidadId: g.grupoId, campo: "prefijoEnCarta" } })).toBe(2);
  });
}

test("espacios a los costados se rechazan con su mensaje; el tope del campo es 20", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Con ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Carne" }] });
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  await expect(campo(page)).toHaveAttribute("maxlength", "20");
  await campo(page).fill("Con ");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no puede empezar ni terminar con espacios" })).toBeVisible();
  expect((await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId }, select: { prefijoEnCarta: true } })).prefijoEnCarta).toBeNull();
});

test("dos pestañas: la vieja cambia el nombre y arrastra el prefijo viejo → «cambió mientras lo editabas»", async ({ paginaAutenticada: pestañaA }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Wok ${m}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Carne" }] });
  const pestañaB = await pestañaA.context().newPage();
  await pestañaA.goto(`/catalogo/opciones/${g.grupoId}`);
  await pestañaB.goto(`/catalogo/opciones/${g.grupoId}`);
  await campo(pestañaA).fill("Con");
  await pestañaA.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(pestañaA.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
  await pestañaB.getByLabel("Nombre", { exact: true }).fill(`E2E Wok B ${m}`);
  await pestañaB.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(pestañaB.getByRole("alert").filter({ hasText: "cambió mientras lo editabas" })).toBeVisible();
  expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: g.grupoId }, select: { nombre: true, prefijoEnCarta: true } })).toEqual({ nombre: `E2E Wok ${m}`, prefijoEnCarta: "Con" });
});

test("una INCLUIDA no muestra «Se lee en la carta como»", async ({ paginaAutenticada: page }) => {
  const m = marca();
  const g = await sembrarGrupo({ nombre: `E2E Guarnición ${m}`, tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Puré" }] });
  await page.goto(`/catalogo/opciones/${g.grupoId}`);
  await expect(campo(page)).toHaveCount(0);
});
