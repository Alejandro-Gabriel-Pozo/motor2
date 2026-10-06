import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Tema de la carta (/carta/tema, docs/plan-tema-carta-2026-09-24.md, M9) de punta a punta: cargar campos del formulario (la vista previa
 * los refleja sin guardar y un valor inválido se marca en el campo), Guardar persiste, Aplicar lo deja aplicado en la carta y Desaplicar
 * lo saca conservando los valores.
 */
test("cargar el formulario, guardar, aplicar y desaplicar el tema de la carta", async ({ paginaAutenticada: page, sucursalId }) => {
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    await page.goto("/carta/tema");
    await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: sin tema");
    // Las zonas son <details> (solo la primera abierta): se abren todas para poder llenar cualquier campo.
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));

    // 1. Cargar el formulario (sin guardar).
    await page.locator('[name="color_item_nombre"]').fill("#aa3300");
    await page.locator('[name="carta_fuente_item_nombre"]').fill("clamp(0.8rem, 2vw, 1rem)");

    // 2. Un valor inválido se marca en su campo…
    await page.locator('[name="color_item_precio"]').fill("red;background:url(x)");
    await expect(page.locator('[data-campo-tema="color_item_precio"]')).toContainText("No es válido");
    await page.locator('[name="color_item_precio"]').fill("");
    // …y el color y el tamaño calculados en la vista previa: clamp(0.8rem, 2vw, 1rem) a 1280 px = 1rem = 16px.
    // (El ítem "Provoleta" de la carta de ejemplo no es especial: usa color_item_nombre; el especial usa color_especial_item_nombre.)
    const nombreItem = page.locator("[data-vista-previa-tema]").getByRole("heading", { name: "Provoleta", level: 3 });
    await expect(nombreItem).toHaveCSS("color", "rgb(170, 51, 0)");
    await expect(nombreItem).toHaveCSS("font-size", "16px");
    // Nada se guardó todavía.
    expect(await prisma.temaCartaSucursal.count({ where: { sucursalId } })).toBe(0);

    // 3. Guardar, recargar: persiste lo cargado.
    await page.getByRole("button", { name: "Guardar tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toContainText('guardado (2 valores cargados; el resto usa el default de la carta). Es un borrador');
    await page.reload();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: borrador");
    await expect(page.locator('[name="color_item_nombre"]')).toHaveValue("#aa3300");
    await expect(page.locator('[name="carta_fuente_item_nombre"]')).toHaveValue("clamp(0.8rem, 2vw, 1rem)");
    await expect(page.locator('[name="color_item_precio"]')).toHaveValue("");
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } })).valores).toEqual({ color_item_nombre: "#aa3300", carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)" });

    // 4. Aplicar: la fila queda aplicada en la carta, con lo guardado (el efecto en la carta pública lo cubre el test siguiente).
    expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } })).aplicarEnCarta).toBe(false);
    await page.getByRole("button", { name: "Aplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "aplicado" })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: tema aplicado");
    const aplicado = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } });
    expect(aplicado.aplicarEnCarta).toBe(true);
    expect(aplicado.valores).toMatchObject({ color_item_nombre: "#aa3300", carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)" });

    // 5. Desaplicar: deja de aplicarse, y los valores se conservan.
    await page.getByRole("button", { name: "Desaplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "desaplicado" })).toBeVisible();
    await expect(page.locator("[data-estado-tema]")).toContainText("Tema: borrador");
    const desaplicado = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } });
    expect(desaplicado.aplicarEnCarta).toBe(false);
    expect(desaplicado.valores).toMatchObject({ color_item_nombre: "#aa3300" });
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  }
});

test("aplicar y desaplicar el tema se ve al instante en la carta pública (invalida el caché de la página)", async ({ paginaAutenticada: page, sucursalId }) => {
  // ADR-006, Fase 4: la página de la sucursal se cachea 5 minutos (`revalidate = 300`); las acciones de carta la invalidan
  // (`revalidarCartasPublicas`). Sin la invalidación, la segunda visita traería la respuesta cacheada de la primera.
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `e2e-tema-vivo-${marca}`;
  const nombre = `Restaurante Vivo ${marca}`;
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  const titulo = page.getByRole("heading", { name: nombre, level: 1 });
  try {
    // Primera visita (queda cacheada): sin tema, no está el nombre.
    await page.goto(`/carta-publica/e2e/${slug}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(titulo).toHaveCount(0);

    await page.goto("/carta/tema");
    await page.locator('[data-zona-tema="Portada e identidad"]').evaluate((el) => ((el as HTMLDetailsElement).open = true));
    await page.locator('[name="restaurante_nombre"]').fill(nombre);
    await page.getByRole("button", { name: "Guardar tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    await page.getByRole("button", { name: "Aplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "aplicado" })).toBeVisible();

    await page.goto(`/carta-publica/e2e/${slug}`);
    await expect(titulo).toHaveCount(1);

    await page.goto("/carta/tema");
    await page.getByRole("button", { name: "Desaplicar el tema" }).click();
    await expect(page.getByRole("status").filter({ hasText: "desaplicado" })).toBeVisible();

    await page.goto(`/carta-publica/e2e/${slug}`);
    await expect(titulo).toHaveCount(0);
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  }
});

test("la vista previa del tema es la carta real: se recorre de a una página (portada → índice → secciones), con flechas y desde el índice", async ({ paginaAutenticada: page, sucursalId }) => {
  // ADR-006, Fase 4: la vista previa dibuja `CartaVista` (el mismo componente de la carta pública) con datos de ejemplo. Sin tema: la
  // portada muestra el nombre por defecto de la carta de ejemplo.
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/carta/tema");
  const vista = page.locator("[data-vista-previa-tema]");
  const siguiente = vista.getByRole("button", { name: "Página siguiente" });
  const anterior = vista.getByRole("button", { name: "Página anterior" });
  const portada = vista.getByRole("heading", { name: "Nombre del restaurante", level: 1 });
  const indice = vista.getByRole("heading", { name: "Índice", level: 1 });
  const entradas = vista.getByRole("heading", { name: "Entradas", level: 2 });
  const fuego = vista.getByRole("heading", { name: "Del fuego", level: 2 });

  // Arranca en la portada: se ve el nombre del restaurante y NO el índice; no se puede ir hacia atrás.
  await expect(portada).toBeInViewport();
  await expect(indice).not.toBeInViewport();
  await expect(anterior).toBeDisabled();
  await expect(vista.locator("[data-carta-topbar]")).toBeVisible();

  // › pasa al índice, con una entrada por sección.
  await siguiente.click();
  await expect(indice).toBeInViewport();
  await expect(portada).not.toBeInViewport();
  await expect(vista.getByRole("button", { name: /Entradas/ })).toBeVisible();
  await expect(vista.getByRole("button", { name: /Del fuego/ })).toBeVisible();
  await expect(vista.getByText("2 / 4")).toBeVisible();

  // › pasa a la primera sección: su banda, su ítem y el botón "Índice" en la barra inferior.
  await siguiente.click();
  await expect(entradas).toBeInViewport();
  await expect(vista.getByRole("heading", { name: "Provoleta", level: 3 })).toBeInViewport();
  await expect(vista.getByRole("button", { name: "Índice" })).toBeVisible();

  // Desde el índice se salta directo a una sección: «Del fuego» trae dos ítems y una promo.
  await vista.getByRole("button", { name: "Índice" }).click();
  await expect(indice).toBeInViewport();
  await vista.getByRole("button", { name: /Del fuego/ }).click();
  await expect(fuego).toBeInViewport();
  await expect(vista.getByRole("heading", { name: "Bife de chorizo", level: 3 })).toBeInViewport();
  await expect(vista.getByRole("heading", { name: "Promo de la casa", level: 3 })).toBeInViewport();

  // No es circular (como la carta pública): en la última página › queda deshabilitado, y ‹ vuelve de a una.
  await expect(siguiente).toBeDisabled();
  await anterior.click();
  await expect(entradas).toBeInViewport();

  // Las flechas no envían el formulario del tema (son type="button"): nada se guardó.
  expect(await prisma.temaCartaSucursal.count({ where: { sucursalId } })).toBe(0);
});

test("la familia tipográfica está en 'Tipografía general' con opciones en castellano y la vista previa la refleja", async ({ paginaAutenticada: page, sucursalId }) => {
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/carta/tema");
  await page.locator('[data-zona-tema="Tipografía general"] > summary').click();
  const campo = page.locator('[data-campo-tema="carta_fuente_familia"]');
  await expect(campo.getByText("Tipografía de títulos, nombres y precios")).toBeVisible();
  const select = campo.locator("select");
  await expect(select.locator("option")).toHaveText([
    "(default de la carta: Playfair Display (serif clásica, la de siempre))",
    "Playfair Display (serif clásica, la de siempre)",
    "Lora (serif de lectura)",
    "Cormorant Garamond (serif elegante)",
    "Montserrat (sans geométrica)",
    "Geist (sans moderna)",
  ]);
  const titulo = page.locator("[data-vista-previa-tema]").getByRole("heading", { name: "Nombre del restaurante", level: 1 });
  await expect(titulo).toHaveCSS("font-family", /Playfair/);
  await select.selectOption("montserrat");
  await expect(titulo).toHaveCSS("font-family", /Montserrat/);
});
