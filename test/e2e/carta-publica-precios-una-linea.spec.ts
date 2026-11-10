import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo, sembrarProductoConOpciones } from "./fixtures/opciones";

/**
 * Carta pública: NINGÚN precio se parte dentro del número («$» arriba, «28.000,0» en el medio y «0» abajo: bug visto en producción el 2026-11-10 con la carta oscura a ~390 px, en las variantes y en
 * los platos de nombre largo). Los importes de la carta salen «$ 15.000» (entero) o «$ 128.500,50» (con centavos): decisión del dueño, el «,00» solo si hay decimales que mostrar.
 *
 * Regla que fija este spec, a 320, 360 y 390 px: cada elemento de precio de la carta (el del renglón, el de cada opción y cada celda de una tabla) mide el alto de UNA línea de texto, y la página no
 * se desborda a lo ancho. Un precio con descuento (`[data-descuento-producto]`) apila a propósito el precio de lista arriba y el de venta abajo: no entra en esta cuenta.
 * Cubre: fila corta, fila con nombre largo («Vino tinto Newen reservado Malbec 750 CC» + «$ 14.000»), subsección de variantes (tabla de UNA columna), tabla de doble entrada de TRES columnas (el café, 12 precios) y
 * precios de 6 dígitos («$ 128.500», «$ 128.500,50»). Única excepción: en la tabla de varias columnas, a 340 px o menos, el «$» puede pasar arriba del número (2 líneas como máximo); jamás se cortan las cifras ni
 * se desborda la caja. El layout no depende del color: el tema oscuro solo cambia colores.
 */
const EMPRESA = "e2e";
const ANCHOS = [320, 360, 390] as const;
const ANCHO_MAXIMO_DEL_ULTIMO_RECURSO = 340;

test("carta pública: ningún precio largo se parte dentro del número ni desborda la página (320, 360 y 390 px)", async ({ page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const slug = `e2e-precios-${m}`;
  const tamano = await sembrarGrupo({ nombre: `Tamaño ${m}`, tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Chico", factorEscala: 0.75 }, { nombre: "Mediano", monto: 500, factorEscala: 1 }, { nombre: "Grande", monto: 1000, factorEscala: 1.5 }] });
  const preparacion = await sembrarGrupo({ nombre: `Preparación ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "Solo" }, { nombre: "Flat white" }, { nombre: "Cortado" }, { nombre: "Con leche", monto: 400 }] });
  const variantes = await sembrarGrupo({ nombre: `Relleno ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: [{ nombre: "De milanesa" }, { nombre: "De bondiola", monto: 4000 }, { nombre: "De vegetales y queso", monto: 6500 }] });
  const cafe = `E2E Café largo ${m}`;
  const sandwich = `E2E Sandwich ${m}`;
  const bife = `E2E Bife largo ${m}`;
  const bifeConCentavos = `E2E Bife con centavos ${m}`;
  const hamburguesa = `E2E Hamburguesa completa ${m}`;
  const vino = `Vino tinto Newen reservado Malbec 750 CC ${m}`;
  const productos = [
    await sembrarProductoConOpciones({ nombre: cafe, codigo: `E2E-PL1-${m}`, precioVenta: 4000, sucursalId, grupos: [{ grupo: tamano }, { grupo: preparacion }] }),
    await sembrarProductoConOpciones({ nombre: sandwich, codigo: `E2E-PL2-${m}`, precioVenta: 24000, sucursalId, grupos: [{ grupo: variantes }] }),
    await sembrarProductoConOpciones({ nombre: bife, codigo: `E2E-PL3-${m}`, precioVenta: 128500, sucursalId, grupos: [] }),
    await sembrarProductoConOpciones({ nombre: bifeConCentavos, codigo: `E2E-PL4-${m}`, precioVenta: 128500.5, sucursalId, grupos: [] }),
    await sembrarProductoConOpciones({ nombre: hamburguesa, codigo: `E2E-PL5-${m}`, precioVenta: 26000, sucursalId, grupos: [] }),
    await sembrarProductoConOpciones({ nombre: vino, codigo: `E2E-PL6-${m}`, precioVenta: 14000, sucursalId, grupos: [] }),
  ];
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección precios ${m}` } });
  for (const [orden, { productoId }] of productos.entries()) await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId, visibleEnCarta: true, seccionCartaId: seccion.id, orden } });
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  try {
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 800 });
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByRole("heading", { name: bife })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const medidas = await page.evaluate((anchoMaximoDelUltimoRecurso) => {
        const precios = [...document.querySelectorAll<HTMLElement>("[data-rol='precio'], [data-rol='opcion-precio']")].filter((el) => !el.closest("[data-descuento-producto]") && el.getAttribute("aria-hidden") !== "true" && el.textContent?.includes("$"));
        return precios.map((el) => {
          const caja = el.getBoundingClientRect();
          const estilo = getComputedStyle(el);
          const linea = parseFloat(estilo.lineHeight) || parseFloat(estilo.fontSize) * 1.4;
          // Último recurso: tabla con VARIAS columnas de precio y 340 px o menos. En cualquier otro caso el precio mide UNA línea.
          const enTablaDeVarias = (el.closest("table")?.querySelectorAll("col").length ?? 0) > 1;
          const lineasPermitidas = enTablaDeVarias && window.innerWidth <= anchoMaximoDelUltimoRecurso ? 2 : 1;
          return { texto: (el.textContent ?? "").trim(), alto: Math.round(caja.height * 10) / 10, linea: Math.round(linea * 10) / 10, partido: caja.height > linea * (lineasPermitidas + 0.3) };
        });
      }, ANCHO_MAXIMO_DEL_ULTIMO_RECURSO);
      // 12 celdas de la tabla del café + 3 variantes del sándwich + 4 renglones simples como mínimo.
      expect(medidas.length, `a ${ancho} px la carta tiene que mostrar precios con «$»`).toBeGreaterThanOrEqual(12);
      expect(
        medidas.filter((x) => x.partido),
        `precios partidos en varias líneas a ${ancho} px (alto > una línea): ${JSON.stringify(medidas.filter((x) => x.partido))}`,
      ).toEqual([]);
      // El importe entero sale sin «,00» y el de centavos con 2 decimales (decisión del dueño, carta pública).
      const textos = medidas.map((x) => x.texto.replace(/\s/g, " "));
      expect(textos, `a ${ancho} px: «$ 128.500» entero, sin «,00»`).toContain("$ 128.500");
      expect(textos, `a ${ancho} px: «$ 128.500,50» con centavos`).toContain("$ 128.500,50");
      expect(textos, `a ${ancho} px: el vino de nombre largo`).toContain("$ 14.000");
      expect(textos.filter((t) => t.endsWith(",00")), `a ${ancho} px: ningún precio de la carta termina en «,00»`).toEqual([]);

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
