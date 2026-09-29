import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { TOKEN_CARTA_E2E } from "./fixtures/carta-token";

/**
 * Tema de la carta (/carta/tema, docs/plan-tema-carta-2026-09-24.md, M9) de punta a punta: "Pegar desde la sheet"
 * clasifica lo pegado y rellena el formulario sin guardar (la vista previa lo refleja), Guardar persiste solo lo válido, Aplicar
 * lo publica en GET /api/carta/[sucursal]/tema y Desaplicar lo saca (404) conservando los valores.
 */
const PEGADO = [
  "color_item_nombre\t#aa3300", // color válido
  "color_item_precio\tred;background:url(x)", // color inválido
  "meta_title\tLa Parrilla — Carta 2026", // SEO: no es por sucursal
  "precio_locale\ten-US", // fija del sistema
  "carta_fuente_item_nombre\tclamp(0.8rem, 2vw, 1rem)",
  "carta_banda_alto_desktop\t90px}body{display:none", // inyección
].join("\n");

test("pegar desde la sheet, guardar, aplicar y desaplicar el tema de la carta", async ({ paginaAutenticada: page, sucursalId, request }) => {
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    await page.goto("/carta/tema");
    await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: sin tema en motor2");

    // 1. Pegar las 6 líneas y rellenar (sin guardar).
    await page.getByLabel(/^Copiá las columnas A y B/).fill(PEGADO);
    await page.getByRole("button", { name: "Rellenar el formulario" }).click();

    // 2. Las listas…
    await expect(page.locator('[data-pegado="valores"]')).toContainText("color_item_nombre");
    await expect(page.locator('[data-pegado="valores"]')).toContainText("carta_fuente_item_nombre");
    await expect(page.locator('[data-pegado="fijasDelSistema"]')).toContainText("precio_locale");
    await expect(page.locator('[data-pegado="noPorTenant"]')).toContainText("meta_title");
    await expect(page.locator('[data-pegado="desconocidas"]')).toContainText("Ninguna.");
    const invalidas = page.locator('[data-pegado="invalidas"]');
    await expect(invalidas).toContainText("color_item_precio");
    await expect(invalidas).toContainText("carta_banda_alto_desktop");
    // …y el color y el tamaño calculados en la vista previa: clamp(0.8rem, 2vw, 1rem) a 1280 px = 1rem = 16px.
    const nombreItem = page.locator('[data-vista-previa-tema] [data-preview="item-nombre"]');
    await expect(nombreItem).toHaveCSS("color", "rgb(170, 51, 0)");
    await expect(nombreItem).toHaveCSS("font-size", "16px");
    // Nada se guardó todavía.
    expect(await prisma.temaCartaSucursal.count({ where: { sucursalId } })).toBe(0);

    // 3. Guardar, recargar: persiste solo lo válido.
    await page.getByRole("button", { name: "Guardar tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toContainText('guardado (2 valores cargados; el resto usa el default de la carta). Es un borrador');
    await page.reload();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: borrador");
    await expect(page.locator('[name="color_item_nombre"]')).toHaveValue("#aa3300");
    await expect(page.locator('[name="carta_fuente_item_nombre"]')).toHaveValue("clamp(0.8rem, 2vw, 1rem)");
    await expect(page.locator('[name="carta_banda_alto_desktop"]')).toHaveValue("");
    await expect(page.locator('[name="color_item_precio"]')).toHaveValue("");
    expect((await prisma.temaCartaSucursal.findUniqueOrThrow({ where: { sucursalId } })).valores).toEqual({ color_item_nombre: "#aa3300", carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)" });

    // 4. Aplicar: el endpoint responde 200 con lo guardado.
    const auth = { Authorization: `Bearer ${TOKEN_CARTA_E2E}` };
    expect((await request.get(`/api/carta/${sucursalId}/tema`, { headers: auth })).status()).toBe(404);
    await page.getByRole("button", { name: "Aplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "aplicado" })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: tema aplicado");
    const r = await request.get(`/api/carta/${sucursalId}/tema`, { headers: auth });
    expect(r.status()).toBe(200);
    const tema = await r.json();
    expect(tema.valores).toMatchObject({ color_item_nombre: "#aa3300", carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)", carta_banda_alto_desktop: null });

    // 5. Desaplicar: 404, y los valores se conservan.
    await page.getByRole("button", { name: "Desaplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "desaplicado" })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: borrador");
    expect((await request.get(`/api/carta/${sucursalId}/tema`, { headers: auth })).status()).toBe(404);
    expect((await prisma.temaCartaSucursal.findUniqueOrThrow({ where: { sucursalId } })).valores).toMatchObject({ color_item_nombre: "#aa3300" });
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  }
});

test("la vista previa del tema se recorre de a una página, como la carta: portada → índice → sección, en círculo", async ({ paginaAutenticada: page, sucursalId }) => {
  // Sin tema: la portada muestra el nombre por defecto de la vista previa.
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.goto("/carta/tema");
  const vista = page.locator("[data-vista-previa-tema]");
  const pagina = (nombre: string) => vista.locator(`[data-vista-previa-pagina="${nombre}"]`);
  const indicador = vista.locator("[data-vista-previa-indicador]");
  const siguiente = vista.getByRole("button", { name: "Página siguiente de la vista previa" });
  const anterior = vista.getByRole("button", { name: "Página anterior de la vista previa" });
  const visibles = (texto: string) => vista.getByText(texto).filter({ visible: true });

  // Arranca en la portada: se ve el nombre del restaurante y NO el índice («Cocina»).
  await expect(pagina("portada")).toBeVisible();
  await expect(pagina("indice")).toBeHidden();
  await expect(pagina("seccion")).toBeHidden();
  await expect(indicador).toHaveText("1 / 3");
  await expect(visibles("Nombre del restaurante")).toHaveCount(1);
  await expect(visibles("Cocina")).toHaveCount(0);
  // Las barras superior e inferior son fijas.
  await expect(vista.locator('[data-preview="topbar"]')).toBeVisible();

  // › pasa al índice: se ve «Cocina» y ya no el nombre del restaurante.
  await siguiente.click();
  await expect(pagina("indice")).toBeVisible();
  await expect(pagina("portada")).toBeHidden();
  await expect(indicador).toHaveText("2 / 3");
  await expect(visibles("Cocina")).toHaveCount(2);
  await expect(visibles("Nombre del restaurante")).toHaveCount(0);
  await expect(vista.locator('[data-preview="topbar"]')).toBeVisible();

  // › pasa a la sección: la banda y los ítems de ejemplo.
  await siguiente.click();
  await expect(pagina("seccion")).toBeVisible();
  await expect(pagina("indice")).toBeHidden();
  await expect(indicador).toHaveText("3 / 3");
  await expect(vista.locator('[data-preview="item-nombre"]')).toHaveText("Bife de chorizo");
  await expect(vista.locator('[data-preview="item-nombre"]')).toBeVisible();
  await expect(vista.locator('[data-preview="banda"]')).toBeVisible();

  // Circular: › desde la sección vuelve a la portada, y ‹ desde la portada va a la sección.
  await siguiente.click();
  await expect(pagina("portada")).toBeVisible();
  await expect(indicador).toHaveText("1 / 3");
  await anterior.click();
  await expect(pagina("seccion")).toBeVisible();
  await anterior.click();
  await expect(pagina("indice")).toBeVisible();
  await expect(indicador).toHaveText("2 / 3");

  // Las flechas no envían el formulario del tema (son type="button"): nada se guardó.
  expect(await prisma.temaCartaSucursal.count({ where: { sucursalId } })).toBe(0);
});
