import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TablaDeDatos, type ColumnaDeTabla, type PropsDeTablaDeDatos } from "../../src/ui/componentes/datos/tabla-de-datos";
import { CampoFecha, RangoDeFechas } from "../../src/ui/componentes/selectores/campo-fecha";

/**
 * Contrato de `TablaDeDatos` y de los selectores de fecha de `src/ui`, sobre el HTML que dibuja el servidor (Vitest corre en Node). Cómo se ven en pantalla —tabla desde sm:,
 * tarjetas en celular, sin scroll horizontal, 44 px, axe— se prueba en un navegador real: test/e2e/ui-datos-y-fechas.spec.ts.
 */
interface Compra {
  id: string;
  proveedor: string;
  fecha: string;
  total: string;
  nota: string;
}
const FILAS: Compra[] = [
  { id: "a", proveedor: "Molino Sur", fecha: "2026-10-01", total: "$ 1.200,00", nota: "pagada" },
  { id: "b", proveedor: "Lácteos del Valle", fecha: "2026-10-02", total: "$ 560,50", nota: "pendiente" },
];
const COLUMNAS: ColumnaDeTabla<Compra>[] = [
  { id: "proveedor", encabezado: "Proveedor", celda: (f) => f.proveedor, titulo: true },
  { id: "fecha", encabezado: "Fecha", celda: (f) => f.fecha },
  { id: "total", encabezado: "Total", celda: (f) => f.total, alinear: "derecha" },
  { id: "nota", encabezado: "Nota", celda: (f) => f.nota, soloEnTabla: true },
];
const VACIO = "Todavía no hay compras. Registrá la primera desde Movimientos.";

function dibujar(filas: Compra[] = FILAS, columnas = COLUMNAS, extra: Partial<PropsDeTablaDeDatos<Compra>> = {}) {
  return renderToStaticMarkup(<TablaDeDatos titulo="Compras registradas" columnas={columnas} filas={filas} claveDeFila={(f) => f.id} vacio={VACIO} {...extra} />);
}

/** Lo que no puede aparecer en ningún HTML de la capa: variantes dark:, grises de escala, rojos de escala, blanco o negro literales. */
const COLOR_DE_ESCALA = /dark:|\b(?:bg|text|border)-(?:neutral|gray|red|white|black)\b|black\//;

describe("TablaDeDatos", () => {
  it("dibuja la tabla con caption, encabezados scope=col y una fila por dato", () => {
    const html = dibujar();
    expect(html).toContain("<caption");
    expect(html).toContain("Compras registradas");
    expect([...html.matchAll(/<th [^>]*scope="col"/g)]).toHaveLength(4);
    // 2 filas de datos (la fila del encabezado lleva otra clase).
    expect([...html.matchAll(/<tr class="border-b">/g)]).toHaveLength(2);
    expect(html).toContain("Molino Sur");
    expect(html).toContain("Lácteos del Valle");
  });

  it("la región con la tabla es enfocable y tiene nombre (se puede desplazar con el teclado)", () => {
    const html = dibujar();
    expect(html).toMatch(/<div role="region" aria-label="Compras registradas" tabindex="0"/);
  });

  it("la misma definición de columnas arma las tarjetas: título aparte, el resto como etiqueta y valor, y lo «solo en tabla» no sale", () => {
    const html = dibujar();
    const lista = /<ul aria-label="Compras registradas"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect([...lista.matchAll(/<li /g)]).toHaveLength(2);
    expect(lista).toContain('<p class="font-medium">Molino Sur</p>');
    expect(lista).toContain("<dt");
    expect(lista).toMatch(/<dt[^>]*>Fecha<\/dt><dd>2026-10-01<\/dd>/);
    expect(lista).toMatch(/<dt[^>]*>Total<\/dt><dd class="text-right">\$ 1\.200,00<\/dd>/);
    expect(lista, "la columna solo-en-tabla no va a la tarjeta").not.toContain("pagada");
    expect(lista, "el título no se repite como par etiqueta-valor").not.toMatch(/<dt[^>]*>Proveedor<\/dt>/);
  });

  it("alterna con CSS: tarjetas solo en celular (sm:hidden), tabla desde sm: (hidden sm:block)", () => {
    const html = dibujar();
    expect(html).toMatch(/<ul[^>]*class="[^"]*\bsm:hidden\b/);
    expect(html).toMatch(/<div role="region"[^>]*class="[^"]*\bhidden\b[^"]*\bsm:block\b/);
  });

  it("si ninguna columna se declara título, la primera lo es", () => {
    const sinTitulo = COLUMNAS.map((c) => ({ ...c, titulo: undefined }));
    expect(dibujar(FILAS, sinTitulo)).toContain('<p class="font-medium">Molino Sur</p>');
  });

  it("sin filas muestra el estado vacío con su próximo paso, avisado como estado, y no dibuja ni tabla ni tarjetas", () => {
    const html = dibujar([]);
    expect(html).toContain(VACIO);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<ul");
  });

  it("dos columnas con el mismo id se rechazan (no hay claves duplicadas ni tarjetas ambiguas)", () => {
    const repetidas: ColumnaDeTabla<Compra>[] = [COLUMNAS[0], { ...COLUMNAS[1], id: "proveedor" }];
    expect(() => dibujar(FILAS, repetidas)).toThrow(/mismo id/);
  });

  it("por defecto el celular ve tarjetas (lo exige el e2e de catalogo-opciones a 375 px): decirlo o no decirlo es lo mismo, y la tabla queda oculta en celular", () => {
    const porDefecto = dibujar();
    expect(dibujar(FILAS, COLUMNAS, { presentacionCelular: "tarjetas" })).toBe(porDefecto);
    expect(porDefecto).toMatch(/<ul aria-label="Compras registradas"[^>]*class="[^"]*\bsm:hidden\b/);
    expect(porDefecto).toMatch(/<div role="region"[^>]*class="[^"]*\bhidden\b/);
    expect(porDefecto).not.toContain("max-sm:min-w-max");
  });

  it("presentacionCelular=tabla-con-scroll: no hay tarjetas y la tabla se ve siempre, con scroll horizontal en celular (la misma tabla, con caption y encabezados scope=col)", () => {
    const html = dibujar(FILAS, COLUMNAS, { presentacionCelular: "tabla-con-scroll" });
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<li");
    const region = /<div role="region"[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
    expect(region).toContain("overflow-x-auto");
    expect(region, "visible también en celular").not.toContain("hidden");
    expect(html).toContain("max-sm:min-w-max");
    expect(html).toMatch(/<div role="region" aria-label="Compras registradas" tabindex="0"/);
    expect(html).toContain("<caption");
    expect([...html.matchAll(/<th [^>]*scope="col"/g)]).toHaveLength(4);
    expect([...html.matchAll(/<tr class="border-b">/g)]).toHaveLength(2);
    expect(html, "la columna solo-en-tabla sí está").toContain("pagada");
  });

  it("claseFila agrega clases a la fila de la tabla y a su tarjeta según el dato, y una fila sin clase no deja «undefined» ni espacios de más", () => {
    const html = dibujar(FILAS, COLUMNAS, { claseFila: (f) => (f.nota === "pendiente" ? "bg-aviso-tinte" : undefined) });
    expect(html).toContain('<tr class="border-b bg-aviso-tinte">');
    expect([...html.matchAll(/<tr class="border-b">/g)], "la otra fila queda como estaba").toHaveLength(1);
    const tarjetas = [...html.matchAll(/<li class="([^"]*)"/g)].map((m) => m[1]);
    expect(tarjetas).toHaveLength(2);
    expect(tarjetas.filter((c) => c.includes("bg-aviso-tinte"))).toHaveLength(1);
    expect(html).not.toContain("undefined");
    expect(tarjetas.every((c) => !c.endsWith(" "))).toBe(true);
  });

  it("orden muestra el sentido con aria-sort solo en el encabezado de esa columna y no reordena las filas", () => {
    const ascendente = dibujar(FILAS, COLUMNAS, { orden: { columna: "fecha", sentido: "ascendente" } });
    const encabezados = [...ascendente.matchAll(/<th [^>]*>[\s\S]*?<\/th>/g)].map((m) => m[0]);
    expect(encabezados).toHaveLength(4);
    expect(encabezados.filter((t) => t.includes("aria-sort"))).toHaveLength(1);
    expect(encabezados.find((t) => t.includes("Fecha"))).toContain('aria-sort="ascending"');
    expect(dibujar(FILAS, COLUMNAS, { orden: { columna: "total", sentido: "descendente" } })).toMatch(/<th [^>]*aria-sort="descending"[^>]*>Total/);
    expect(dibujar(), "sin orden no hay aria-sort").not.toContain("aria-sort");
    // Las filas salen en el orden en que llegaron, aunque el orden diga otra cosa.
    const invertidas = dibujar([...FILAS].reverse(), COLUMNAS, { orden: { columna: "proveedor", sentido: "ascendente" } });
    expect(invertidas.indexOf("Lácteos del Valle")).toBeLessThan(invertidas.indexOf("Molino Sur"));
  });

  it("un orden que nombra una columna que no existe se rechaza (no hay un aria-sort que no apunta a nada)", () => {
    expect(() => dibujar(FILAS, COLUMNAS, { orden: { columna: "zzz", sentido: "ascendente" } })).toThrow(/columna «zzz»/);
  });

  it("solo tokens del sistema en las tres presentaciones (tabla, tarjetas y vacío): sin dark:, sin grises ni rojos de escala", () => {
    const todo = [dibujar(), dibujar(FILAS, COLUMNAS, { presentacionCelular: "tabla-con-scroll", orden: { columna: "fecha", sentido: "ascendente" } }), dibujar([])].join("\n");
    expect(todo).not.toMatch(COLOR_DE_ESCALA);
    expect(todo).toContain("text-tinta-suave");
    expect(todo).toContain("border-borde");
  });

  it("es un componente de servidor: no lleva «use client» ni usa hooks de estado (no manda JavaScript al navegador)", () => {
    const fuente = readFileSync(join(__dirname, "../../src/ui/componentes/datos/tabla-de-datos.tsx"), "utf8");
    expect(fuente).not.toMatch(/^\s*["']use client["']/m);
    expect(fuente).not.toMatch(/\buse(State|Effect|Reducer)\b/);
  });
});

describe("CampoFecha y RangoDeFechas", () => {
  it("CampoFecha es el input nativo type=date con su etiqueta atada", () => {
    const html = renderToStaticMarkup(<CampoFecha etiqueta="Fecha de la compra" name="fecha" min="2026-01-01" max="2026-12-31" />);
    expect(html).toContain('type="date"');
    expect(html).toContain('min="2026-01-01"');
    expect(html).toContain('max="2026-12-31"');
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it("RangoDeFechas es un fieldset con leyenda y dos fechas con nombre propio (sin valores viejos: lo que se envía es lo que se ve)", () => {
    const html = renderToStaticMarkup(<RangoDeFechas leyenda="Período" desde={{ name: "desde", defaultValue: "2026-10-01" }} hasta={{ name: "hasta", defaultValue: "2026-10-10" }} />);
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("Período");
    expect(html).toContain('name="desde"');
    expect(html).toContain('name="hasta"');
    expect(html).toContain('value="2026-10-01"');
    expect(html).toContain('value="2026-10-10"');
    expect([...html.matchAll(/type="date"/g)]).toHaveLength(2);
  });

  it("«hasta» no se puede elegir antes de «desde» ni «desde» después de «hasta» en el selector del navegador", () => {
    const html = renderToStaticMarkup(<RangoDeFechas leyenda="Período" desde={{ name: "desde", defaultValue: "2026-10-01" }} hasta={{ name: "hasta", defaultValue: "2026-10-10" }} minimo="2026-01-01" maximo="2026-12-31" />);
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    const desde = inputs.find((i) => i.includes('name="desde"')) ?? "";
    const hasta = inputs.find((i) => i.includes('name="hasta"')) ?? "";
    expect(desde).toContain('min="2026-01-01"');
    expect(desde).toContain('max="2026-10-10"');
    expect(hasta).toContain('min="2026-10-01"');
    expect(hasta).toContain('max="2026-12-31"');
  });

  it("con error: mensaje con role=alert dentro del grupo; sin error, no hay alerta", () => {
    const con = renderToStaticMarkup(<RangoDeFechas leyenda="Período" desde={{ name: "d" }} hasta={{ name: "h" }} error="«Hasta» no puede ser anterior a «Desde»." />);
    expect(con).toContain('role="alert"');
    expect(con).toContain("no puede ser anterior");
    expect(renderToStaticMarkup(<RangoDeFechas leyenda="Período" desde={{ name: "d" }} hasta={{ name: "h" }} />)).not.toContain('role="alert"');
  });

  it("la ayuda y el error del rango usan tokens (tinta suave y error), sin dark: ni colores de escala", () => {
    const html = renderToStaticMarkup(<RangoDeFechas leyenda="Período" desde={{ name: "d" }} hasta={{ name: "h" }} ayuda="Fechas inclusivas" error="«Hasta» no puede ser anterior a «Desde»." />);
    expect(html).toMatch(/<p class="[^"]*\btext-tinta-suave\b[^"]*">Fechas inclusivas<\/p>/);
    expect(html).toMatch(/<p role="alert" class="[^"]*\btext-error\b[^"]*">/);
    expect(html).not.toMatch(COLOR_DE_ESCALA);
  });

  it("también es un componente de servidor (sin JavaScript, como SelectorRango)", () => {
    const fuente = readFileSync(join(__dirname, "../../src/ui/componentes/selectores/campo-fecha.tsx"), "utf8");
    expect(fuente).not.toMatch(/^\s*["']use client["']/m);
  });
});
