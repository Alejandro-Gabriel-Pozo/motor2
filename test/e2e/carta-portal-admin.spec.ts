import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { resolverEmpresaCarta } from "../../src/core/carta/empresa-carta";
import { resolverPortalCarta } from "../../src/core/carta/publica-consulta";

/**
 * Portal de sucursales (/carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7) de punta a punta: agregar dos
 * sucursales cuyos nombres dan el mismo slug (la segunda queda con `-2`, visible en la pantalla), el choque de slug al editar se
 * muestra con el nombre de la otra sucursal, guardar dominio/posición/sheet y publicar queda en la base y en el portal de la carta pública, y
 * "Quitar del portal" borra la fila.
 */
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-e2e";

test("agregar, chocar slugs, guardar y quitar desde el portal de sucursales", async ({ paginaAutenticada: page }) => {
  const marca = `${Date.now()}`;
  const nombreA = `E2E Portal Villa La Angostura ${marca}`;
  const nombreB = `E2E Portal Villa la Angostura ${marca}`;
  const slug = `e2e-portal-villa-la-angostura-${marca}`;
  const [a, b] = await Promise.all([nombreA, nombreB].map((nombre) => prisma.sucursal.create({ data: { nombre } })));

  try {
    await page.goto("/carta/portal");
    await expect(page.getByRole("heading", { name: "Portal de sucursales", level: 1 })).toBeVisible();
    const filaA = page.locator(`[data-sucursal-portal="${nombreA}"]`);
    const filaB = page.locator(`[data-sucursal-portal="${nombreB}"]`);
    await expect(filaA).toContainText("no está en el portal");

    // 1. Agregar las dos: mismo slug base, la segunda lleva -2 (colisión visible).
    await filaA.getByRole("button", { name: `Agregar «${nombreA}» al portal` }).click();
    await expect(filaA).toContainText(`/carta/${slug} · sin publicar`);
    await filaB.getByRole("button", { name: `Agregar «${nombreB}» al portal` }).click();
    await expect(filaB).toContainText(`/carta/${slug}-2 · sin publicar`);

    // 2. Editar el slug de B para que choque con el de A: error con el nombre de A, y no se guarda.
    await filaB.locator("summary").click();
    await filaB.getByLabel(/^Slug/).fill(slug);
    await filaB.getByRole("button", { name: `Guardar «${nombreB}»` }).click();
    await expect(filaB.getByRole("alert")).toHaveText(`El slug ${slug} ya lo usa "${nombreA}".`);

    // 3. Guardar dominio, posición y sheet de A, y publicarla.
    await filaA.locator("summary").click();
    await filaA.getByLabel("Dominio propio (opcional)").fill(`https://Carta-${marca}.Example.com/`);
    await filaA.getByLabel("Subtítulo en el portal (público, opcional)").fill("Frente al lago");
    await filaA.getByLabel("x (centro)").fill("12.5");
    await filaA.getByLabel("y (centro)").fill("40");
    await filaA.getByLabel("Ancho").fill("8");
    await filaA.getByLabel(/^Id de la sheet/).fill(SHEET);
    await filaA.getByLabel("Publicada en el portal").check();
    await filaA.getByRole("button", { name: `Guardar «${nombreA}»` }).click();
    await expect(filaA.getByRole("status")).toHaveText(`Portal: "${nombreA}" guardada y publicada.`);
    await expect(filaA).toContainText(`/carta/${slug} · publicada`);

    // Links a la carta nueva de motor2 (ADR-006, Fase 4): solo la sucursal publicada tiene el suyo (empresa `e2e` de la base).
    await expect(filaA.getByRole("link", { name: "Ver la carta de motor2 →" })).toHaveAttribute("href", `/carta-publica/e2e/${slug}`);
    await expect(filaB.getByRole("link", { name: "Ver la carta de motor2 →" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ver el portal de motor2 →" })).toHaveAttribute("href", "/carta-publica/e2e");

    // Lo guardado en la base (lo que lee la carta pública) y el portal resuelto: A publicada con lo cargado, B sin publicar.
    const filaAdb = await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: a.id } });
    expect(filaAdb).toMatchObject({ slug, dominio: `carta-${marca}.example.com`, subtituloPortal: "Frente al lago", orden: 0, publicada: true, menuDesdeMotor2: false, sheetId: SHEET, sheetMenuNombre: "Menu" });
    expect([filaAdb.posX, filaAdb.posY, filaAdb.posW].map(Number)).toEqual([12.5, 40, 8]);
    expect(filaAdb.posH).toBeNull();
    expect(await prisma.sucursalPublica.findFirstOrThrow({ where: { sucursalId: b.id } })).toMatchObject({ slug: `${slug}-2`, publicada: false });
    const empresa = await resolverEmpresaCarta("e2e", prisma);
    if (!empresa) throw new Error("la empresa e2e no existe");
    const portal = await resolverPortalCarta(empresa, prisma);
    expect(portal.find((e) => e.slug === slug)).toEqual({ slug, etiqueta: nombreA, subtitulo: "Frente al lago" });
    expect(portal.find((e) => e.slug === `${slug}-2`)).toBeUndefined();

    // 4. Quitar B del portal: vuelve a "no está en el portal" y la fila ya no existe.
    await filaB.getByRole("button", { name: `Quitar «${nombreB}» del portal` }).click();
    await expect(filaB).toContainText("no está en el portal");
    await expect(filaB.getByRole("button", { name: `Agregar «${nombreB}» al portal` })).toBeVisible();
    expect(await prisma.sucursalPublica.count({ where: { sucursalId: b.id } })).toBe(0);
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [a.id, b.id] } } });
    await prisma.sucursal.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  }
});
