import { test, expect } from "./fixtures/auth";
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
