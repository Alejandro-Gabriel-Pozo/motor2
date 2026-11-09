import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { armarFichaDeCocina, type RecetaParaFicha } from "../../src/core/catalogo/public";
import { FichaDeCocinaVista } from "../../src/components/catalogo/ficha-de-cocina/ficha-de-cocina-vista";
import {
  COLUMNAS_DE_RECETA_INGREDIENTE,
  COLUMNAS_DE_RECETA_PASO,
  COLUMNAS_DE_RECETA_VERSION,
  DIMENSIONES,
  NUNCA,
  VERSION_DE,
  esperado,
  type Combinacion,
} from "./ficha-de-cocina.reglas";

/**
 * Ficha de cocina imprimible (`docs/diseno-ficha-de-cocina-2026-11-08.md`). Sin base de datos ni navegador: el armado puro, el render y el CSS de impresión. El permiso, la receta de otra
 * empresa y la denegación los cubre lo que ya cubría la pantalla de la receta (misma guarda `guardar_receta`, mismas consultas; ver el diseño, nivel 8).
 */
const AHORA = new Date("2026-11-08T15:10:00.000Z"); // 12:10 en Argentina

const ING = (id: string, nombre: string, cantidad: number, unidad: string) => ({ id, cantidad, unidad: { nombre: unidad }, insumoProducto: { nombre }, mermaPorcentaje: 8, sustitutos: [{ insumoSustituto: { nombre: "Peceto" } }] });
const INGREDIENTES = [ING("i1", "Bife de nalga", 0.22, "kg"), ING("i2", "Huevo", 1, "unidad"), ING("i3", "Pan rallado", 0.06, "kg"), ING("i6", "Sal fina", 0.005, "kg")];
const QUE = (...ids: string[]) => ids.map((id) => ({ recetaIngrediente: INGREDIENTES.find((i) => i.id === id)! }));

/** La fila de la base TAL COMO viene (con merma, sustitutos y costos de más): lo que la ficha no declara, no tiene que salir. */
function receta(c: Combinacion): RecetaParaFicha & Record<string, unknown> {
  const con = c.fichaTecnica === "con";
  return {
    version: VERSION_DE[c.origen],
    costoUnitario: 1234,
    ingredientes: INGREDIENTES.map((i) => (c.sustitutos === "con" ? i : { ...i, sustitutos: [] })),
    pasos:
      c.pasos === "con"
        ? [
            { orden: 2, nombre: "Freír", instruccion: "En aceite a 180 °C hasta dorar de ambos lados.", minutos: 6, ingredientes: [] },
            { orden: 1, nombre: "Apanar", instruccion: "Pasar la carne por huevo batido con sal y luego por pan rallado.", minutos: 10, ingredientes: QUE("i2", "i6", "i3") },
          ]
        : [],
    rendimientoCantidad: con ? "1.0000" : null,
    rendimientoUnidad: con ? { nombre: "unidad" } : null,
    racionesCantidad: con ? 1 : null,
    racionTamano: con ? "450.0000" : null,
    racionUnidad: con ? { nombre: "g" } : null,
    tiempoPreparacionMinutos: con ? 25 : null,
    tiempoCoccionMinutos: con ? 15 : null,
    comentarios: con ? "Plato de carta. Se pide bien dorada." : null,
    presentacionEmplatado: con ? "Milanesa entera al centro del plato.\nPapas fritas al costado." : null,
    notasAdicionales: con ? "Reponer el rebozado cada 2 horas en servicio." : null,
    equipamientoNecesario: con ? "Freidora\nplancha de apanar\nbandeja gastronorm" : null,
  };
}

const COMBINACIONES: Combinacion[] = DIMENSIONES.origen.flatMap((origen) =>
  DIMENSIONES.fichaTecnica.flatMap((fichaTecnica) => DIMENSIONES.sustitutos.flatMap((sustitutos) => DIMENSIONES.pasos.map((pasos) => ({ origen, fichaTecnica, sustitutos, pasos })))),
);

function imprimir(c: Combinacion): string {
  const ficha = armarFichaDeCocina({ productoNombre: "Milanesa con papas fritas", sucursalNombre: "Varvarco", origen: c.origen, receta: receta(c), ahora: AHORA });
  return renderToStaticMarkup(<FichaDeCocinaVista ficha={ficha} />);
}

describe("la ficha de cocina: todas las combinaciones contra la tabla de reglas", () => {
  it("son las 16 combinaciones de las 4 dimensiones declaradas", () => {
    expect(COMBINACIONES).toHaveLength(16);
  });

  for (const c of COMBINACIONES) {
    it(`origen ${c.origen} · ficha técnica ${c.fichaTecnica} · sustitutos ${c.sustitutos} · pasos ${c.pasos}`, () => {
      const html = imprimir(c);
      const { presentes, ausentes } = esperado(c);
      for (const texto of presentes) expect(html, `debe decir «${texto}»`).toContain(texto);
      for (const texto of [...ausentes, ...NUNCA]) expect(html, `NO debe decir «${texto}»`).not.toContain(texto);
    });
  }

  it("los pasos salen en su orden (1 antes que 2), aunque lleguen desordenados", () => {
    const html = imprimir({ origen: "CENTRAL", fichaTecnica: "con", sustitutos: "con", pasos: "con" });
    expect(html.indexOf("1. Apanar")).toBeLessThan(html.indexOf("2. Freír"));
  });

  it("un paso sin nombre sale «Paso N», sin inventar nada más", () => {
    const base = receta({ origen: "CENTRAL", fichaTecnica: "sin", sustitutos: "sin", pasos: "con" });
    const ficha = armarFichaDeCocina({ productoNombre: "X", sucursalNombre: "S", origen: "CENTRAL", receta: { ...base, pasos: [{ orden: 1, nombre: null, instruccion: "Hornear.", minutos: null, ingredientes: [] }] }, ahora: AHORA });
    const html = renderToStaticMarkup(<FichaDeCocinaVista ficha={ficha} />);
    expect(html).toContain("1. Paso 1");
    expect(html).not.toContain("min");
  });

  it("una receta sin ingredientes dice «pendiente de completar», no una tabla vacía", () => {
    const base = receta({ origen: "CENTRAL", fichaTecnica: "sin", sustitutos: "sin", pasos: "sin" });
    const ficha = armarFichaDeCocina({ productoNombre: "X", sucursalNombre: "S", origen: "CENTRAL", receta: { ...base, ingredientes: [] }, ahora: AHORA });
    const html = renderToStaticMarkup(<FichaDeCocinaVista ficha={ficha} />);
    expect(html).toContain("Ingredientes: pendiente de completar.");
    expect(html).not.toContain("<table");
  });

  it("la hora de impresión es la de Argentina (UTC-3): 02:30 UTC del 9/11 es todavía el 8/11", () => {
    const base = receta({ origen: "CENTRAL", fichaTecnica: "sin", sustitutos: "sin", pasos: "sin" });
    const ficha = armarFichaDeCocina({ productoNombre: "X", sucursalNombre: "S", origen: "CENTRAL", receta: base, ahora: new Date("2026-11-09T02:30:00.000Z") });
    expect(ficha.impresaEn).toBe("08/11/2026 23:30");
  });
});

describe("guardián de dimensiones: una columna nueva de la receta se declara si imprime o no", () => {
  const declaradas = (m: Record<string, string>) => Object.keys(m).sort();
  const reales = (e: Record<string, string>) => Object.keys(e).sort();
  it("RecetaVersion", () => expect(reales(Prisma.RecetaVersionScalarFieldEnum)).toEqual(declaradas(COLUMNAS_DE_RECETA_VERSION)));
  it("RecetaIngrediente", () => expect(reales(Prisma.RecetaIngredienteScalarFieldEnum)).toEqual(declaradas(COLUMNAS_DE_RECETA_INGREDIENTE)));
  it("RecetaPaso", () => expect(reales(Prisma.RecetaPasoScalarFieldEnum)).toEqual(declaradas(COLUMNAS_DE_RECETA_PASO)));
});

describe("el papel (@media print de globals.css, bloque «Ficha de cocina»)", () => {
  const CSS = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");
  const BLOQUE = CSS.slice(CSS.indexOf("@page ficha-cocina"));
  const MARCA = "body:has([data-ficha-cocina])";

  it("A4 vertical con página con nombre", () => {
    expect(BLOQUE).toMatch(/@page ficha-cocina \{\s*size: A4 portrait;/);
    expect(BLOQUE).toMatch(/\[data-ficha-cocina\] \{\s*page: ficha-cocina;/);
  });

  it("al imprimir se ocultan el menú lateral, su botón, la barra superior y los controles de pantalla, solo si hay una ficha", () => {
    for (const selector of ["aside", "header", 'button[aria-label="Ocultar menú"]', "[data-ficha-solo-pantalla]"]) expect(BLOQUE).toContain(`${MARCA} ${selector}`);
    expect(BLOQUE).toMatch(/display: none !important;/);
  });

  it("corte limpio: el contenedor flex pasa a bloque de alto libre y un paso o bloque no se parte", () => {
    expect(BLOQUE).toMatch(/div:has\(\[data-ficha-cocina\]\) \{\s*display: block !important;\s*height: auto !important;/);
    expect(BLOQUE).toMatch(/\.ficha-paso,[\s\S]*break-inside: avoid;/);
  });

  it("los controles de pantalla de la página llevan la marca, y la ficha no trae enlaces ni botones", () => {
    const pagina = readFileSync(join(__dirname, "../../src/app/(app)/catalogo/recetas/[productoId]/ficha/page.tsx"), "utf8");
    expect(pagina).toContain('data-ficha-solo-pantalla="true"');
    const vista = readFileSync(join(__dirname, "../../src/components/catalogo/ficha-de-cocina/ficha-de-cocina-vista.tsx"), "utf8");
    expect(vista).not.toMatch(/<(Link|Enlace|Boton|button|a)\b/);
  });
});
