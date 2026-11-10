import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Carta pública: NINGÚN precio se parte dentro del número («$» arriba, «28.000,0» en el medio y «0» abajo: bug visto en producción el 2026-11-10 con la carta oscura a ~390 px, en una subsección de
 * variantes). Dinero siempre con 2 decimales (regla del dueño, 2026-11-10) hace los importes más largos («$ 28.000,00», «$ 128.500,00»), y una columna de precio de ancho fijo los cortaba.
 *
 * Regla que fija este spec, a 320, 360 y 390 px: cada elemento de precio de la carta (el del renglón, el de cada opción y cada celda de una tabla) mide el alto de UNA línea de texto, y la página no
 * se desborda a lo ancho. Un precio con descuento (`[data-descuento-producto]`) apila a propósito el precio de lista arriba y el de venta abajo: no entra en esta cuenta.
 * Cubre las formas: renglón simple, lista de opciones, tabla de UNA columna (variantes) y tabla de TRES columnas (café con tamaños), todas con importes de 5 y 6 cifras. La tabla de varias columnas es la única que puede
 * pasar el «$» arriba del número (2 líneas como máximo) y solo cuando ni con la columna ensanchada entra; jamás desborda la caja.
 */
const EMPRESA = "e2e";
const ANCHOS = [320, 360, 390] as const;

test("carta pública: ningún precio largo se parte dentro del número ni desborda la página (320, 360 y 390 px)", async ({ page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const slug = `e2e-precios-${m}`;
  const tamano = await sembrarGrupo({ nombre: `Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 0.75 }, { nombre: "Mediano", monto: 500, factorEscala: 1 }, { nombre: "Grande", monto: 1000, factorEscala: 1.5 }] });
  const variantes = await sembrarGrupo({ nombre: `Relleno ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De milanesa" }, { nombre: "De bondiola", monto: 4000 }, { nombre: "De vegetales y queso", monto: 6500 }] });
  const cafe = `E2E Café largo ${m}`;
  const sandwich = `E2E Sandwich ${m}`;
  const bife = `E2E Bife largo ${m}`;
  const { productoId: cafeId } = await sembrarProductoConOpciones({ nombre: cafe, codigo: `E2E-PL1-${m}`, precioVenta: 4500, sucursalId, grupos: [{ grupo: tamano }] });
  const { productoId: sandwichId } = await sembrarProductoConOpciones({ nombre: sandwich, codigo: `E2E-PL2-${m}`, precioVenta: 24000, sucursalId, grupos: [{ grupo: variantes }] });
  const { productoId: bifeId } = await sembrarProductoConOpciones({ nombre: bife, codigo: `E2E-PL3-${m}`, precioVenta: 128500, sucursalId, grupos: [] });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección precios ${m}` } });
  for (const [orden, productoId] of [cafeId, sandwichId, bifeId].entries()) await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden } });
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  try {
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 800 });
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByRole("heading", { name: bife })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const medidas = await page.evaluate(() => {
        const precios = [...document.querySelectorAll<HTMLElement>("[data-rol='precio'], [data-rol='opcion-precio']")].filter((el) => !el.closest("[data-descuento-producto]") && el.getAttribute("aria-hidden") !== "true" && el.textContent?.includes("$"));
        return precios.map((el) => {
          const caja = el.getBoundingClientRect();
          const estilo = getComputedStyle(el);
          const linea = parseFloat(estilo.lineHeight) || parseFloat(estilo.fontSize) * 1.4;
          // Tabla con VARIAS columnas de precio (café con tamaños): a un ancho de celular tres importes de 6 cifras no caben en una línea; ahí, y solo ahí, el «$» puede pasar arriba del número (2 líneas
          // como máximo). En cualquier otra forma (renglón, lista de opciones, tabla de UNA columna) el precio mide UNA línea.
          const enTablaDeVarias = (el.closest("table")?.querySelectorAll("col").length ?? 0) > 1;
          const lineasPermitidas = enTablaDeVarias ? 2 : 1;
          return { texto: (el.textContent ?? "").trim(), alto: Math.round(caja.height * 10) / 10, linea: Math.round(linea * 10) / 10, partido: caja.height > linea * (lineasPermitidas + 0.3) };
        });
      });
      expect(medidas.length, `a ${ancho} px la carta tiene que mostrar precios con «$»`).toBeGreaterThanOrEqual(5);
      expect(
        medidas.filter((x) => x.partido),
        `precios partidos en varias líneas a ${ancho} px (alto > una línea): ${JSON.stringify(medidas.filter((x) => x.partido))}`,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `la página se desborda a ${ancho} px`).toBe(true);
      const tablas = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("table[data-tabla-carta]")].map((t) => ({ ancho: t.scrollWidth, caja: (t.parentElement as HTMLElement).clientWidth })));
      expect(tablas.length, "tiene que haber tablas de la carta").toBeGreaterThanOrEqual(1);
      expect(
        tablas.filter((t) => t.ancho > t.caja + 1),
        `una tabla se sale de su caja a ${ancho} px`,
      ).toEqual([]);
    }
  } finally {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { seccionCartaId: seccion.id } });
    await prisma.seccionCarta.delete({ where: { id: seccion.id } });
  }
});
