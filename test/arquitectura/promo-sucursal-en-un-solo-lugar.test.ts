import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (ADR-009, R1/R4): "qué promos ofrece una sucursal y a qué precio" se decide en UN solo lugar, `core/carta/promo-sucursal.ts`
 * (`wherePromoOfrecidaEn`, `seleccionDeSucursalDePromo`, `precioDePromo`). Una promo es de la empresa y se ofrece en una sucursal solo con una fila
 * ACTIVA de `PromoCartaSucursal` (sin fila = no se ofrece). Si un lector escribe ese filtro a mano, puede olvidarse de `activa: true` o de la
 * sucursal y mostrar promos de más (o de menos) sin que nada lo note.
 *
 * Cómo se controla, fuera de comentarios y fuera del embudo:
 *  1. Un archivo que habla de promos no filtra la relación `sucursales` a mano (`sucursales: { some: ... }` o `sucursales: { where: ... }`).
 *  2. Nadie lee `promoCartaSucursal` directo (`find*` / `count` / `aggregate` / `groupBy`): se lee a través de la relación de `PromoCarta` con
 *     `seleccionDeSucursalDePromo`. Las escrituras (`upsert`, `create`, `update`) no entran en la regla.
 */
const RAIZ = join(__dirname, "../../src");
const EMBUDO = "core/carta/promo-sucursal.ts";
const FILTRO_A_MANO = /\bsucursales\s*:\s*\{\s*(some|where)\b/;
const LECTURA_DIRECTA = /\bpromoCartaSucursal\s*\.\s*(find|count|aggregate|groupBy)/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** El fuente sin las líneas de comentario (se reemplazan por líneas vacías para conservar la numeración). */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => {
      const t = l.trim();
      return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") ? "" : l;
    })
    .join("\n");
}

function lineaDe(texto: string, indice: number): number {
  return texto.slice(0, indice).split("\n").length;
}

/** Las violaciones (`<regla>:<línea>`) de un fuente; el filtro a mano admite saltos de línea entre `sucursales:` y `{ some`. */
function violaciones(fuente: string): string[] {
  const limpio = sinComentarios(fuente);
  const malas: string[] = [];
  if (/promo/i.test(limpio)) {
    const filtro = FILTRO_A_MANO.exec(limpio);
    if (filtro) malas.push(`filtro-a-mano:${lineaDe(limpio, filtro.index)}`);
  }
  const lectura = LECTURA_DIRECTA.exec(limpio);
  if (lectura) malas.push(`lectura-directa:${lineaDe(limpio, lectura.index)}`);
  return malas;
}

describe("promo por sucursal: se resuelve en un solo lugar", () => {
  const rutas = archivos(RAIZ);

  it("encuentra archivos de src/ y el embudo", () => {
    expect(rutas.length).toBeGreaterThan(50);
    expect(rutas.map((r) => relative(RAIZ, r).split(sep).join("/"))).toContain(EMBUDO);
  });

  it("ningún archivo fuera del embudo filtra las promos de la sucursal a mano ni lee PromoCartaSucursal directo", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = relative(RAIZ, ruta).split(sep).join("/");
      if (nombre === EMBUDO) continue;
      for (const v of violaciones(readFileSync(ruta, "utf8"))) problemas.push(`${nombre} (${v})`);
    }
    expect(problemas, `Usá wherePromoOfrecidaEn / seleccionDeSucursalDePromo / precioDePromo de core/carta/promo-sucursal.ts:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("el embudo sigue siendo quien define el filtro (la regla no quedó vacía)", () => {
    const embudo = readFileSync(join(RAIZ, EMBUDO), "utf8");
    expect(FILTRO_A_MANO.test(sinComentarios(embudo))).toBe(true);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca un filtro a mano de la relación, también partido en varias líneas", () => {
      expect(violaciones("const promos = await db.promoCarta.findMany({ where: { activa: true, sucursales: { some: { sucursalId } } } });")).toEqual(["filtro-a-mano:1"]);
      expect(violaciones("const promo = 1;\nawait db.promoCarta.findMany({\n  where: {\n    sucursales:\n  {\n some: { sucursalId } } },\n});")).toEqual(["filtro-a-mano:4"]);
      expect(violaciones("const promo = 1;\nawait db.promoCarta.findMany({ where: { sucursales: {\n some: { sucursalId } } } });")).toEqual(["filtro-a-mano:2"]);
      expect(violaciones("await db.promoCarta.findMany({ select: { sucursales: { where: { sucursalId } } } });")).toEqual(["filtro-a-mano:1"]);
    });

    it("marca una lectura directa de PromoCartaSucursal, sobre una transacción y con espacios", () => {
      expect(violaciones("await tx.promoCartaSucursal.findMany({});")).toEqual(["lectura-directa:1"]);
      expect(violaciones("await db.promoCartaSucursal . count({});")).toEqual(["lectura-directa:1"]);
    });

    it("no marca comentarios, escrituras, includes sin filtro ni un `sucursales` de otro modelo", () => {
      expect(violaciones("// antes: promoCartaSucursal.findMany({}) y sucursales: { some: {} } de la promo")).toEqual([]);
      expect(violaciones("await ctx.db.promoCartaSucursal.upsert({});")).toEqual([]);
      expect(violaciones("await db.promoCarta.findUnique({ include: { sucursales: { select: { precioLocal: true } } } });")).toEqual([]);
      expect(violaciones("await db.usuario.findMany({ where: { sucursales: { some: { sucursalId } } } });")).toEqual([]);
    });
  });
});
