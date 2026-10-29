import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: «¿qué grupos de opciones lee la carta de este producto?» se decide en UN solo lugar —`resumenDePreciosParaLaCarta` y `tablaDePreciosParaLaCarta`
 * (`core/pos/precio-de-configuracion.ts`), que aplican `seOcultaEnLaCarta` (`core/opciones/lectura-en-carta.ts`)—. Decisión del dueño del 2026-10-29 («Mostrar este grupo en la carta»,
 * diseño `docs/diseno-ocultar-grupo-en-carta-2026-10-29.md`, I5). Un lector de la carta que llame `resumenDePrecios` a secas muestra un grupo que otro oculta: la carta en pantalla, la impresa,
 * la vista previa del producto y el «Va a mostrar» de Carta › Hoy dejarían de coincidir, y TypeScript no lo detecta (las dos funciones tipan igual).
 *
 * Cómo se controla: ningún archivo de `src/server/lecturas/carta/`, `src/server/consultas/carta/` ni `src/server/carta-publica/` menciona `resumenDePrecios` (la forma sin «ParaLaCarta») fuera de un
 * comentario. El POS, el selector, el cobro y «Opciones agotadas» (que SÍ usan `resumenDePrecios` o no pasan por la carta) viven en otras carpetas y no están alcanzados.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETAS_DE_LA_CARTA = ["server/lecturas/carta", "server/consultas/carta", "server/carta-publica"];
const RESUMEN_A_SECAS = /\bresumenDePrecios\b(?!ParaLaCarta)/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** Las líneas (1-based) que mencionan `resumenDePrecios` a secas (llamada o import) fuera de un comentario. */
function lineasConResumenDePreciosASecas(fuente: string): number[] {
  const malas: number[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (RESUMEN_A_SECAS.test(linea)) malas.push(i + 1);
    });
  return malas;
}

const enCarpetasDeLaCarta = (ruta: string) => CARPETAS_DE_LA_CARTA.some((c) => relative(RAIZ, ruta).split(sep).join("/").startsWith(`${c}/`));

describe("grupos de la carta: un solo lugar decide cuáles se leen", () => {
  const rutas = archivos(RAIZ);
  const deLaCarta = rutas.filter(enCarpetasDeLaCarta);

  it("encuentra los archivos de la carta", () => {
    expect(deLaCarta.length).toBeGreaterThan(10);
  });

  it("ningún lector de la carta llama `resumenDePrecios` a secas: todos pasan por `resumenDePreciosParaLaCarta`", () => {
    const problemas: string[] = [];
    for (const ruta of deLaCarta) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      for (const linea of lineasConResumenDePreciosASecas(readFileSync(ruta, "utf8"))) problemas.push(`${nombre}:${linea}`);
    }
    expect(
      problemas,
      `Estas líneas leen el resumen de precios sin pasar por resumenDePreciosParaLaCarta (core/pos/precio-de-configuracion): la carta mostraría un grupo que el dueño ocultó:\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("los tres lectores que arman las opciones de la carta usan el punto único (la regla no quedó sin lectores)", () => {
    for (const lector of ["server/lecturas/carta/menu.ts", "server/consultas/carta/mantenimiento.ts", "server/consultas/carta/vista-previa-de-un-producto.ts"]) {
      expect(readFileSync(join(RAIZ, lector), "utf8"), lector).toMatch(/\bresumenDePreciosParaLaCarta\(/);
    }
  });

  it("el punto único calcula con TODOS los grupos y filtra la salida (no el cálculo)", () => {
    const fuente = readFileSync(join(RAIZ, "core/pos/precio-de-configuracion.ts"), "utf8");
    const cuerpo = fuente.slice(fuente.indexOf("export function resumenDePreciosParaLaCarta"), fuente.indexOf("/** Un grupo vigente tal como lo lee la carta"));
    expect(cuerpo).toMatch(/resumenDePrecios\(entrada\)/);
    expect(cuerpo).toMatch(/\.filter\(/);
    expect(fuente).toMatch(/const ocultos = gruposOcultosEnLaCarta\(entrada\.grupos\);\s*const grupos: GrupoDeLaTablaDeLaCarta\[\] = resumen\.grupos\.filter\(/);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca la vuelta a `resumenDePrecios` en un lector (la mutación de prueba)", () => {
      const fuente = ["const enCarta = opcionesParaLaCarta(resumenDePrecios({ grupos, precioBase, descuentoDeProducto: null, esBase }));"].join("\n");
      expect(lineasConResumenDePreciosASecas(fuente)).toEqual([1]);
    });

    it("marca también el import", () => {
      expect(lineasConResumenDePreciosASecas('import { resumenDePrecios, tablaDePreciosParaLaCarta } from "@/core/pos/public";')).toEqual([1]);
    });

    it("no marca el punto único ni un comentario que menciona la función", () => {
      const fuente = ["const enCarta = opcionesParaLaCarta(resumenDePreciosParaLaCarta({ grupos }));", " * la misma regla que la venta (`resumenDePrecios`)", "// resumenDePrecios"].join("\n");
      expect(lineasConResumenDePreciosASecas(fuente)).toEqual([]);
    });
  });
});
