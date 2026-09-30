import { test, expect } from "./fixtures/auth";
import AxeBuilder from "@axe-core/playwright";
import { prisma } from "../../src/lib/db";

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
    await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: s.id, titulo: `E2E Promo ${i} ${marca}`, precio: 1000 * i } });
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
        await siguiente.click(); // índice: sigue el empujoncito
        await expect.poll(() => siguiente.evaluate((el) => getComputedStyle(el).animationName)).toBe("carta-nudge");
        await siguiente.click(); // primera sección: ya no
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
