import { test, expect } from "./fixtures/auth";
import AxeBuilder from "@axe-core/playwright";
import { prisma } from "./fixtures/db";

/**
 * Paridad UX de la carta pública con restaurant-menu-design (C1–C9) y las claves de tema que hoy no tenían efecto en la carta.
 * Cada test crea SU carta (slug único, secciones con una promo cada una) y la borra al terminar. Dos tamaños: mobile 390×844
 * y desktop 1280×900.
 */
const EMPRESA = "e2e";
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

interface CartaE2E {
  slug: string;
  marca: string;
  ruta: string;
  seccionIds: string[];
  limpiar: () => Promise<void>;
}

async function crearCarta(sucursalId: string, opciones: { secciones?: number; valores?: Record<string, string> } = {}): Promise<CartaE2E> {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `e2e-pu-${marca}`;
  const secciones: string[] = [];
  for (let i = 1; i <= (opciones.secciones ?? 4); i++) {
    const s = await prisma.seccionCarta.create({ data: { nombre: `E2E Sec ${i} ${marca}` } });
    await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: s.id, titulo: `E2E Promo ${i} ${marca}`, precio: 1000 * i } });
    secciones.push(s.id);
  }
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  if (opciones.valores) await prisma.temaCartaSucursal.create({ data: { sucursalId, aplicarEnCarta: true, valores: opciones.valores } });
  return {
    slug,
    marca,
    ruta: `/carta-publica/${EMPRESA}/${slug}`,
    seccionIds: secciones,
    limpiar: async () => {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCartaSucursal.deleteMany({ where: { promoCarta: { seccionCartaId: { in: secciones } } } });
      await prisma.promoCarta.deleteMany({ where: { seccionCartaId: { in: secciones } } });
      await prisma.seccionCarta.deleteMany({ where: { id: { in: secciones } } });
    },
  };
}

test.describe("carta pública: índice (C5)", () => {
  test("grilla de 1 / 2 / 3 columnas según el ancho, con el número tabular de 28px", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 6 });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      const lista = page.locator("[data-carta-indice-lista]");
      const columnas = () => lista.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(await columnas()).toBe(1);
      await page.setViewportSize({ width: 800, height: 900 });
      expect(await columnas()).toBe(2);
      await page.setViewportSize(DESKTOP);
      expect(await columnas()).toBe(3);
      const numero = lista.locator("li").first().locator("span").first();
      expect((await numero.boundingBox())?.width).toBe(28);
      expect(await numero.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
      expect(await lista.evaluate((el) => getComputedStyle(el).columnGap)).toBe("48px");
    } finally {
      await carta.limpiar();
    }
  });
});

// Tema oscuro tipo "hdnqn": fondo casi negro, marca violeta oscura y las claves de color que hasta ahora no tenían efecto.
const TEMA_OSCURO = {
  color_fondo_dia: "#181818",
  color_marca: "#5c57a2",
  color_portada_textos: "#ffffff",
  color_portada_cta: "#e0e0e0",
  color_indice_numeros: "#b9b5f0",
  color_indice_titulo: "#f5f5f5",
  color_indice_titulos: "#eeeeee",
  color_banda_etiqueta: "#b9b5f0",
  color_banda_titulo: "#ffffff",
  color_banda_descripcion: "#d0d0d0",
  color_nav_flechas: "#b9b5f0",
  color_nav_iconos: "#dddddd",
  restaurante_instagram: "@e2e",
  topbar_back_label: "← PORTAL",
  topbar_back_color: "#ffffff",
  topbar_back_size: "14",
  carta_texto_portada_cta: "Deslizá",
};

const color = (el: import("@playwright/test").Locator) => el.evaluate((n) => getComputedStyle(n).color);

test.describe("carta pública: colores del tema (claves de color, C8 y tinta base)", () => {
  test("con el tema oscuro cada zona toma su color, la tinta base sigue al fondo y el botón de volver es el configurado", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: TEMA_OSCURO });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const portada = page.locator(".carta-pagina").first();
        expect(await color(portada)).toBe("rgb(255, 255, 255)");
        expect(await color(portada.getByText("Deslizá"))).toBe("rgb(224, 224, 224)");
        expect(await portada.getByText("Deslizá").evaluate((n) => getComputedStyle(n).opacity)).toBe("1");
        // La raíz pinta el fondo del tema (antes quedaba el blanco de `.carta-shell`).
        expect(await page.locator("[data-carta-libro]").evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgb(24, 24, 24)");
        // Íconos de redes de la nav: color final, sin opacidad decorativa.
        const icono = page.locator("[data-carta-nav] a[aria-label='Instagram']");
        expect(await color(icono)).toBe("rgb(221, 221, 221)");
        expect(await icono.evaluate((n) => getComputedStyle(n).opacity)).toBe("1");
        expect(await color(page.getByRole("button", { name: "Página siguiente" }))).toBe("rgb(185, 181, 240)");

        await page.getByRole("button", { name: "Página siguiente" }).click();
        const indice = page.locator("[data-carta-indice-lista]");
        await expect(indice).toBeVisible();
        const numero = indice.locator("li").first().locator("span").first();
        expect(await color(numero)).toBe("rgb(185, 181, 240)");
        expect(await color(indice.locator("li").first().locator("span").nth(1))).toBe("rgb(238, 238, 238)");
        expect(await color(page.getByRole("heading", { name: "Índice", level: 1 }))).toBe("rgb(245, 245, 245)");

        await page.locator("[data-ir-a]").first().click();
        const banda = page.locator("[data-carta-banda]").first();
        await expect(page.getByText(`E2E Promo 1 ${carta.marca}`)).toBeVisible();
        // C8: la etiqueta es solo "NN / NN", sin el nombre de la sección adelante.
        const etiqueta = banda.locator("p").first();
        await expect(etiqueta).toHaveText("01 / 03");
        expect(await color(etiqueta)).toBe("rgb(185, 181, 240)");
        expect(await color(banda.locator("h2"))).toBe("rgb(255, 255, 255)");
        // Tinta base derivada del fondo: los ítems (sin color propio) salen claros, no casi negros.
        expect(await color(page.getByText(`E2E Promo 1 ${carta.marca}`))).toContain("oklch(0.96");
      }
    } finally {
      await carta.limpiar();
    }
  });

  test("topbar: el texto, color y tamaño de 'volver' salen del tema; sin tema queda '← Menú' de 12px tenue", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: TEMA_OSCURO });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const volver = page.locator("[data-carta-topbar]").getByText("← PORTAL");
        await expect(volver).toBeVisible();
        expect(await color(volver)).toBe("rgb(255, 255, 255)");
        expect(await volver.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
        expect(await volver.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      }
    } finally {
      await carta.limpiar();
    }
    const sin = await crearCarta(sucursalId, { secciones: 2 });
    try {
      await page.goto(sin.ruta);
      const volver = page.locator("[data-carta-topbar]").getByText("← Menú");
      await expect(volver).toBeVisible();
      expect(await volver.evaluate((el) => getComputedStyle(el).fontSize)).toBe("12px");
      expect(await volver.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.6");
    } finally {
      await sin.limpiar();
    }
  });

  test("sin tema cargado la carta se ve como siempre: números de marca, etiqueta sin prefijo, tinta oscura", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3 });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      await page.getByRole("button", { name: "Página siguiente" }).click();
      const numero = page.locator("[data-carta-indice-lista] li").first().locator("span").first();
      expect(await color(numero)).toBe("rgb(146, 64, 14)"); // --carta-primary por defecto
      await page.locator("[data-ir-a]").first().click();
      await expect(page.locator("[data-carta-banda] p").first()).toHaveText("01 / 03");
      expect(await page.locator("[data-carta-libro]").evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgb(255, 255, 255)");
      expect(await color(page.getByText(`E2E Promo 1 ${carta.marca}`))).toBe("rgb(28, 27, 25)");
    } finally {
      await carta.limpiar();
    }
  });

  test("axe: con el tema oscuro la banda cumple contraste en mobile y desktop", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: TEMA_OSCURO });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        await page.getByRole("button", { name: "Página siguiente" }).click();
        await expect(page.locator("[data-carta-indice-lista]")).toBeVisible();
        await page.locator("[data-ir-a]").first().click();
        await expect(page.getByText(`E2E Promo 1 ${carta.marca}`)).toBeVisible();
        const banda = await new AxeBuilder({ page }).include("[data-carta-banda]").withRules(["color-contrast"]).analyze();
        expect(banda.violations).toEqual([]);
      }
    } finally {
      await carta.limpiar();
    }
  });

  test("print: con tema oscuro el texto sale negro sobre blanco", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: TEMA_OSCURO });
    try {
      await page.setViewportSize(DESKTOP);
      await page.goto(carta.ruta);
      await page.emulateMedia({ media: "print" });
      const p = await page.evaluate(() => ({
        fondo: getComputedStyle(document.querySelector("[data-carta-libro]")!).backgroundColor,
        texto: getComputedStyle(document.querySelector("[data-carta-libro] h1")!).color,
      }));
      expect(p).toEqual({ fondo: "rgb(255, 255, 255)", texto: "rgb(0, 0, 0)" });
    } finally {
      await carta.limpiar();
    }
  });
});

test.describe("carta pública: portada (fondo y posición, C7)", () => {
  const PORTADA = { color_marca: "#5c57a2", hero_color_fondo: "#181818", carta_texto_portada_cta: "Deslizá", restaurante_subtitulo: "Sub e2e" };

  test("hero_color_fondo pinta la portada y el texto se deriva por contraste (sin color_portada_textos)", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: PORTADA });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const portada = page.locator(".carta-pagina").first();
        expect(await portada.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe("rgb(24, 24, 24)");
        expect(await color(portada)).toContain("oklch(0.96");
        expect(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(false);
      }
    } finally {
      await carta.limpiar();
    }
  });

  test("mobile 390×844: el bloque va a carta_pos_bloque % desde arriba y el CTA a carta_pos_cta % del pie", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: { ...PORTADA, carta_pos_bloque: "20", carta_pos_cta: "30" } });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      const bloque = (await page.locator("[data-portada-bloque]").boundingBox())!;
      const cta = (await page.locator("[data-portada-cta]").boundingBox())!;
      // top:20% del alto de la portada (844), corrido su propio alto × 20%.
      expect(bloque.y).toBeCloseTo(0.2 * MOBILE.height - 0.2 * bloque.height, 0);
      expect(cta.y + cta.height).toBeCloseTo(MOBILE.height - 0.3 * MOBILE.height, 0);
      expect(Math.abs(bloque.x + bloque.width / 2 - MOBILE.width / 2)).toBeLessThan(1);
    } finally {
      await carta.limpiar();
    }
  });

  test("mobile con los defaults (50 / 18): bloque centrado, CTA cerca del pie y sin superponerse", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: PORTADA });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      const bloque = (await page.locator("[data-portada-bloque]").boundingBox())!;
      const cta = (await page.locator("[data-portada-cta]").boundingBox())!;
      expect(bloque.y + bloque.height / 2).toBeCloseTo(MOBILE.height / 2, 0);
      expect(cta.y + cta.height).toBeCloseTo(MOBILE.height - 0.18 * MOBILE.height, 0);
      expect(bloque.y + bloque.height).toBeLessThan(cta.y);
    } finally {
      await carta.limpiar();
    }
  });

  test("desktop 1280×900: las posiciones de mobile NO aplican (bloque y CTA en el flujo centrado)", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: { ...PORTADA, carta_pos_bloque: "10", carta_pos_cta: "40" } });
    try {
      await page.setViewportSize(DESKTOP);
      await page.goto(carta.ruta);
      const pos = await page.evaluate(() => ({
        bloque: getComputedStyle(document.querySelector("[data-portada-bloque]")!).position,
        cta: getComputedStyle(document.querySelector("[data-portada-cta]")!).position,
      }));
      expect(pos).toEqual({ bloque: "static", cta: "static" });
      const bloque = (await page.locator("[data-portada-bloque]").boundingBox())!;
      const cta = (await page.locator("[data-portada-cta]").boundingBox())!;
      expect(bloque.y).toBeGreaterThan(0.2 * DESKTOP.height); // no pegado arriba (10 %): centrado con el CTA
      expect(cta.y).toBeGreaterThan(bloque.y + bloque.height - 1);
      expect(Math.abs(bloque.x + bloque.width / 2 - DESKTOP.width / 2)).toBeLessThan(1);
    } finally {
      await carta.limpiar();
    }
  });

  test("con imagen de fondo, hero_color_fondo tiñe el velo (mix del color, no el --carta-bg)", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 2, valores: { ...PORTADA, hero_imagen_fondo_url: "https://example.com/fondo.jpg" } });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      const velo = page.locator(".carta-pagina").first().locator("div[aria-hidden]").first();
      const fondo = await velo.evaluate((n) => getComputedStyle(n).backgroundColor);
      // 75 % de #181818 sobre transparente (oklch, luminosidad ≈ 0,21 y opacidad .75), no el blanco de --carta-bg (luminosidad 1).
      const m = fondo.match(/^oklch\(([\d.]+) [^/]*\/ ([\d.]+)\)$/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThan(0.3);
      expect(Number(m![2])).toBeCloseTo(0.75, 2);
    } finally {
      await carta.limpiar();
    }
  });
});

test.describe("carta pública: alto de la banda (C6)", () => {
  async function irASeccion(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: "Página siguiente" }).click();
    await page.locator("[data-ir-a]").first().click();
    const banda = page.locator("[data-carta-banda]").first();
    await expect(banda).toBeVisible();
    return banda;
  }

  test("por defecto: 90px en mobile y clamp(80px, 18vh, 140px) en desktop, con el contenido adentro de la banda", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3 });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      let banda = await irASeccion(page);
      expect((await banda.boundingBox())!.height).toBeCloseTo(90, 0);
      const h2m = await banda.locator("h2").boundingBox();
      const bm = (await banda.boundingBox())!;
      expect(h2m!.y).toBeGreaterThanOrEqual(bm.y);
      expect(h2m!.y + h2m!.height).toBeLessThanOrEqual(bm.y + bm.height + 0.5);
      const fsMobile = await banda.locator("h2").evaluate((n) => parseFloat(getComputedStyle(n).fontSize));

      await page.setViewportSize(DESKTOP);
      await page.goto(carta.ruta);
      banda = await irASeccion(page);
      // 18vh de 900 = 162 → tope 140.
      expect((await banda.boundingBox())!.height).toBeCloseTo(140, 0);
      const fsDesktop = await banda.locator("h2").evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      expect(fsDesktop / fsMobile).toBeCloseTo(1.5, 1);
      const h2d = await banda.locator("h2").boundingBox();
      const bd = (await banda.boundingBox())!;
      expect(h2d!.y).toBeGreaterThanOrEqual(bd.y);
      expect(h2d!.y + h2d!.height).toBeLessThanOrEqual(bd.y + bd.height + 0.5);
      // La etiqueta no queda tapada por el topbar fijo.
      const topbar = await page.locator("[data-carta-topbar]").first().boundingBox().catch(() => null);
      const etiqueta = (await banda.locator("p").first().boundingBox())!;
      if (topbar) expect(etiqueta.y).toBeGreaterThanOrEqual(topbar.y + topbar.height - 0.5);
    } finally {
      await carta.limpiar();
    }
  });

  test("los valores del tema mandan: un número pelado es px, una medida se respeta", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: { carta_banda_alto_mobile: "130", carta_banda_alto_desktop: "200" } });
    try {
      await page.setViewportSize(MOBILE);
      await page.goto(carta.ruta);
      expect((await (await irASeccion(page)).boundingBox())!.height).toBeCloseTo(130, 0);
      await page.setViewportSize(DESKTOP);
      await page.goto(carta.ruta);
      expect((await (await irASeccion(page)).boundingBox())!.height).toBeCloseTo(200, 0);
    } finally {
      await carta.limpiar();
    }
  });
});

test.describe("carta pública: navegación y layout (C1–C4)", () => {
  test("C1: cada página respeta el alto real de la nav y el topbar, y el deslizamiento para en cada página", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3 });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const nav = page.locator("[data-carta-nav]");
        await expect(nav).toBeVisible();
        const altoNav = (await nav.boundingBox())!.height;
        // El alto se publica en la raíz (lo heredan las páginas) y coincide con el medido.
        await expect
          .poll(() => page.locator("[data-carta-libro]").evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue("--carta-nav-h-local"))))
          .toBeCloseTo(altoNav, 0);
        const pagina = page.locator(".carta-pagina").nth(2);
        const estilo = await pagina.evaluate((el) => {
          const c = getComputedStyle(el);
          return { pt: c.paddingTop, pb: c.paddingBottom, stop: c.scrollSnapStop };
        });
        expect(estilo.stop).toBe("always");
        expect(estilo.pt).toBe("40px");
        expect(Math.abs(parseFloat(estilo.pb) - altoNav)).toBeLessThan(1);
        // Ir a la primera sección: la banda queda POR DEBAJO del topbar y el último ítem POR ENCIMA de la nav.
        await page.locator("[data-ir-a]").first().click();
        await expect(page.getByText(`E2E Promo 1 ${carta.marca}`)).toBeVisible();
        const topbar = (await page.locator("[data-carta-topbar]").boundingBox())!;
        const banda = (await pagina.locator("h2").boundingBox())!;
        expect(banda.y).toBeGreaterThanOrEqual(topbar.y + topbar.height - 1);
        const navCaja = (await nav.boundingBox())!;
        const ultimo = (await page.getByText(`E2E Promo 1 ${carta.marca}`).boundingBox())!;
        expect(ultimo.y + ultimo.height).toBeLessThanOrEqual(navCaja.y + 1);
      }
    } finally {
      await carta.limpiar();
    }
  });

  test("C2: flechas circulares de 48px con el color de marca; el empujoncito dura 3 vueltas, solo en portada e índice y no con reducir movimiento", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: { color_marca: "#123456" } });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const siguiente = page.getByRole("button", { name: "Página siguiente" });
        const anterior = page.getByRole("button", { name: "Página anterior" });
        const caja = (await siguiente.boundingBox())!;
        expect([caja.width, caja.height]).toEqual([48, 48]);
        const estilo = await siguiente.evaluate((el) => {
          const c = getComputedStyle(el);
          return { radio: c.borderTopLeftRadius, borde: c.borderTopWidth, color: c.color, nombre: c.animationName, vueltas: c.animationIterationCount };
        });
        expect(estilo.borde).toBe("1px");
        expect(parseFloat(estilo.radio)).toBeGreaterThanOrEqual(24);
        expect(estilo.color).toBe("rgb(18, 52, 86)");
        expect([estilo.nombre, estilo.vueltas]).toEqual(["carta-nudge", "3"]);
        expect(await anterior.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
        // El deslizamiento es suave y `current` sale del scroll: hay que esperar a que la página DESTINO esté quieta antes del próximo clic. Sin esa
        // espera, un clic con el scroll a medias (runner lento) parte de la página vieja, vuelve a ir al índice y el empujoncito nunca se apaga.
        const enPagina = (n: number) =>
          expect.poll(() => page.locator("[data-carta-slider]").evaluate((el, destino) => Math.abs(el.scrollLeft / el.clientWidth - destino) < 0.01, n), { message: `esperando la página ${n}` }).toBe(true);
        await siguiente.click(); // índice: sigue el empujoncito
        await enPagina(1);
        await expect.poll(() => siguiente.evaluate((el) => getComputedStyle(el).animationName)).toBe("carta-nudge");
        await siguiente.click(); // primera sección: ya no
        await enPagina(2);
        await expect.poll(() => siguiente.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(carta.ruta);
      expect(await page.getByRole("button", { name: "Página siguiente" }).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    } finally {
      await carta.limpiar();
    }
  });

  test("C3: el degradé de hay-más aparece con contenido largo, se va al llegar al final y no aparece con contenido corto", async ({ page, sucursalId }) => {
    const larga = await crearCarta(sucursalId, { secciones: 30 });
    try {
      await page.setViewportSize({ width: 390, height: 500 });
      await page.goto(larga.ruta);
      const aviso = page.locator("[data-carta-aviso-scroll]");
      await expect(page.locator("[data-carta-nav]")).toBeVisible();
      await expect(aviso).toHaveCount(0); // portada: sin aviso
      await page.getByRole("button", { name: "Página siguiente" }).click();
      await expect(aviso).toHaveCount(1);
      await expect(aviso).toHaveAttribute("aria-hidden", "true");
      const caja = (await aviso.boundingBox())!;
      const navCaja = (await page.locator("[data-carta-nav]").boundingBox())!;
      expect(Math.abs(caja.y + caja.height - navCaja.y)).toBeLessThan(1.5); // apoyado sobre la nav
      await page.locator("[data-carta-indice-lista]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(aviso).toHaveCount(0);
    } finally {
      await larga.limpiar();
    }
    const corta = await crearCarta(sucursalId, { secciones: 2 });
    try {
      await page.setViewportSize(DESKTOP);
      await page.goto(corta.ruta);
      await page.getByRole("button", { name: "Página siguiente" }).click();
      await expect(page.locator("[data-carta-indice-lista]")).toBeVisible();
      await expect(page.locator("[data-carta-aviso-scroll]")).toHaveCount(0);
    } finally {
      await corta.limpiar();
    }
  });

  test("C4: la carta pública bloquea el scroll del documento y al imprimir se libera", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3 });
    try {
      for (const vp of [MOBILE, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(carta.ruta);
        const d = await page.evaluate(() => ({
          html: getComputedStyle(document.documentElement).overflow,
          body: getComputedStyle(document.body).overflow,
          desborda: document.documentElement.scrollHeight > document.documentElement.clientHeight || document.documentElement.scrollWidth > document.documentElement.clientWidth,
          raiz: document.querySelector("[data-carta-libro]")!.getBoundingClientRect().height,
        }));
        expect([d.html, d.body, d.desborda]).toEqual(["hidden", "hidden", false]);
        expect(d.raiz).toBe(vp.height);
        await page.emulateMedia({ media: "print" });
        const impreso = await page.evaluate(() => ({
          html: getComputedStyle(document.documentElement).overflow,
          raiz: getComputedStyle(document.querySelector("[data-carta-libro]")!).overflow,
          slider: getComputedStyle(document.querySelector("[data-carta-slider]")!).display,
        }));
        expect(impreso.html).toBe("visible");
        expect(impreso.raiz).toBe("visible");
        expect(impreso.slider).toBe("block");
        await page.emulateMedia({ media: "screen" });
      }
    } finally {
      await carta.limpiar();
    }
  });

  test("C4: /carta/tema (vista previa embebida) NO queda bloqueada", async ({ paginaAutenticada: page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/carta/tema");
    await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
    await expect(page.locator("[data-vista-previa-tema] [data-carta-slider]")).toBeVisible();
    expect(await page.locator("[data-carta-libro]").count()).toBe(0);
    const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
    expect(overflow).not.toBe("hidden");
  });

  test("C1–C4: sin violaciones de axe en portada e índice", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3 });
    try {
      await page.goto(carta.ruta);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole("button", { name: "Página siguiente" }).click();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await carta.limpiar();
    }
  });
});

test.describe("carta pública: familia tipográfica (carta_fuente_familia)", () => {
  const TEXTOS = { restaurante_nombre: "Casa E2E", restaurante_subtitulo: "Desde 1985", hero_etiqueta_superior: "Restaurante" };
  const familia = (el: import("@playwright/test").Locator) => el.evaluate((n) => getComputedStyle(n).fontFamily);

  // Títulos, nombres y precios llevan la familia elegida; las etiquetas, subtítulos, contadores y botones quedan en la sans (Geist), como la carta original.
  async function verificar(page: import("@playwright/test").Page, carta: CartaE2E, titulos: RegExp) {
    for (const vp of [MOBILE, DESKTOP]) {
      await page.setViewportSize(vp);
      await page.goto(carta.ruta);
      const portada = page.locator(".carta-pagina").first();
      expect(await familia(portada.getByRole("heading", { level: 1 })), `nombre en portada ${vp.width}`).toMatch(titulos);
      expect(await familia(portada.getByText("Restaurante", { exact: true })), `etiqueta de portada ${vp.width}`).toMatch(/Geist/);
      expect(await familia(portada.getByText("Desde 1985")), `subtítulo ${vp.width}`).toMatch(/Geist/);

      await page.getByRole("button", { name: "Página siguiente" }).click();
      const indice = page.locator("[data-carta-indice-lista]");
      await expect(indice).toBeVisible();
      expect(await familia(page.getByRole("heading", { name: "Índice", level: 1 })), `título del índice ${vp.width}`).toMatch(titulos);
      expect(await familia(indice.locator("li").first().locator("span").nth(1)), `sección del índice ${vp.width}`).toMatch(titulos);
      expect(await familia(indice.locator("li").first().locator("span").first()), `número del índice ${vp.width}`).toMatch(/Geist/);
      expect(await familia(page.locator("[data-carta-nav]").getByText(/^\d+ \/ \d+$/)), `contador ${vp.width}`).toMatch(/Geist/);

      await page.locator("[data-ir-a]").first().click();
      const nombre = page.getByText(`E2E Promo 1 ${carta.marca}`);
      await expect(nombre).toBeVisible();
      expect(await familia(nombre), `nombre del ítem ${vp.width}`).toMatch(titulos);
      expect(await familia(nombre.locator("xpath=following-sibling::span").first()), `precio ${vp.width}`).toMatch(titulos);
      expect(await familia(page.locator("[data-carta-banda] h2").first()), `título de la banda ${vp.width}`).toMatch(titulos);
      expect(await familia(page.locator("[data-carta-banda] p").first()), `etiqueta de la banda ${vp.width}`).toMatch(/Geist/);
      expect(await familia(page.getByRole("button", { name: "Índice" })), `botón Índice ${vp.width}`).toMatch(/Geist/);
      expect(await familia(page.locator("[data-carta-topbar]").getByText("← Menú")), `botón volver ${vp.width}`).toMatch(/Geist/);
    }
  }

  test("por defecto: Playfair en títulos, nombres y precios; sans en los textos chicos", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: TEXTOS });
    try {
      await verificar(page, carta, /Playfair/);
    } finally {
      await carta.limpiar();
    }
  });

  test("carta_fuente_familia = lora: los títulos cambian y los textos chicos siguen en la sans", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: { ...TEXTOS, carta_fuente_familia: "lora" } });
    try {
      await verificar(page, carta, /Lora/);
    } finally {
      await carta.limpiar();
    }
  });

  test("un valor libre (Comic Sans MS) cae a Playfair: no se cuela como font-family", async ({ page, sucursalId }) => {
    const carta = await crearCarta(sucursalId, { secciones: 3, valores: { ...TEXTOS, carta_fuente_familia: "Comic Sans MS" } });
    try {
      await verificar(page, carta, /Playfair/);
    } finally {
      await carta.limpiar();
    }
  });
});
