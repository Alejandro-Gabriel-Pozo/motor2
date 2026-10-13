import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (GO-2b, ADR-030; molde de `lectores-de-receta.test.ts`), en DOS capas:
 *
 * 1. EMBUDO: elegir «la versión VIGENTE» de una opción de venta (la de `numero` mayor) pasa SOLO por `server/lecturas/opciones/opciones-para-vender.ts` (con la
 *    regla pura `versionVigente` de `core/opciones/version-vigente.ts`). Ningún otro archivo de `src/` puede leer `VersionDeOpcion` por su cuenta
 *    (`versionDeOpcion.find*`/`groupBy`/`count`/`aggregate`), pedir las versiones anidadas de una opción (`versiones: …`) ni nombrarla en SQL crudo: así no hay dos
 *    formas de la misma regla (si el dueño elige una fecha de vigencia, cambia en un solo lugar).
 * 2. CLASIFICACIÓN: todo archivo que lee la versión CONGELADA en la foto de una línea (`versionDeOpcion: …` anidado desde `OpcionElegidaEnLinea`) o
 *    `ConsumoDeOpcion` directo tiene que estar en la lista de abajo, con motivo: esos leen la versión que se VENDIÓ (la de la foto), nunca la vigente. Una pantalla
 *    de administración del catálogo (GO-2a) que liste el historial de versiones se declara acá también, con su motivo.
 *
 * Los comentarios se descartan sobre el archivo entero y los patrones se buscan también a través de saltos de línea.
 */
const SRC = join(__dirname, "../../src");
const EMBUDO = "server/lecturas/opciones/opciones-para-vender.ts";
const EMBUDO_PURO = "core/opciones/version-vigente.ts";

const LECTORES_DE_LA_VERSION_CONGELADA: readonly { ruta: string; motivo: string }[] = [];

const RUTAS_CLASIFICADAS = new Set(LECTORES_DE_LA_VERSION_CONGELADA.map((a) => a.ruta));

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** El archivo sin comentarios (`//` y `/* *\/`), conservando los saltos de línea y lo que está dentro de un string o una plantilla. */
function sinComentarios(fuente: string): string {
  const s = fuente.replace(/\r\n/g, "\n");
  let salida = "";
  let modo: '"' | "'" | "`" | null = null;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const siguiente = s[i + 1];
    if (modo) {
      salida += c;
      if (c === "\\") {
        salida += siguiente ?? "";
        i += 2;
        continue;
      }
      if (c === modo || (c === "\n" && modo !== "`")) modo = null;
      i++;
      continue;
    }
    if (c === "/" && siguiente === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && siguiente === "*") {
      const fin = s.indexOf("*/", i + 2);
      const bloque = fin === -1 ? s.slice(i) : s.slice(i, fin + 2);
      salida += bloque.replace(/[^\n]/g, " ");
      i += bloque.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") modo = c;
    salida += c;
    i++;
  }
  return salida;
}

/** Las formas de leer o elegir versiones de una opción que SOLO el embudo puede escribir. */
const PATRONES_DEL_EMBUDO: readonly RegExp[] = [/\bversionDeOpcion\s*\.\s*(find\w*|groupBy|count|aggregate)/, /\bversiones\s*:\s*\{/, /\b(FROM|JOIN)\s+"VersionDeOpcion"/i];

function eligeLaVersionPorSuCuenta(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return PATRONES_DEL_EMBUDO.some((re) => re.test(limpia));
}

/** Leer la versión congelada en la foto o los consumos de una versión: hay que declararse. */
const LECTURA_CONGELADA: readonly RegExp[] = [/\bversionDeOpcion\s*:\s*\{/, /\bconsumoDeOpcion\s*\.\s*find\w*/];

function necesitaClasificacion(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return LECTURA_CONGELADA.some((re) => re.test(limpia));
}

describe("lectores de la versión de una opción: el embudo es el único que elige la vigente", () => {
  const fuentes = new Map(archivosFuente(SRC).map((ruta) => [relative(SRC, ruta).split(sep).join("/"), readFileSync(ruta, "utf8")]));

  it("encuentra archivos de src/", () => {
    expect(fuentes.size).toBeGreaterThan(50);
  });

  it("ningún archivo fuera del embudo lee o elige versiones de una opción por su cuenta", () => {
    const sueltos = [...fuentes].filter(([nombre, fuente]) => nombre !== EMBUDO && nombre !== EMBUDO_PURO && eligeLaVersionPorSuCuenta(fuente)).map(([nombre]) => nombre);
    expect(sueltos, `Estos archivos eligen o leen versiones de una opción sin pasar por ${EMBUDO}:\n${sueltos.join("\n")}`).toEqual([]);
  });

  it("el embudo existe, lee las versiones y elige la vigente con la regla pura", () => {
    const fuente = fuentes.get(EMBUDO);
    expect(fuente, `${EMBUDO} no existe: actualizá EMBUDO`).toBeDefined();
    expect(eligeLaVersionPorSuCuenta(fuente!), `${EMBUDO} ya no lee las versiones`).toBe(true);
    expect(sinComentarios(fuente!)).toMatch(/\bversionVigente\s*\(/);
  });

  it("todo lector de la versión congelada (o de los consumos) está declarado, y ninguno declarado dejó de serlo", () => {
    const encontrados = new Set([...fuentes].filter(([nombre, fuente]) => nombre !== EMBUDO && necesitaClasificacion(fuente)).map(([nombre]) => nombre));
    const sinDeclarar = [...encontrados].filter((n) => !RUTAS_CLASIFICADAS.has(n));
    expect(sinDeclarar, `Estos archivos leen la versión de la foto o los consumos de una opción y no están en LECTORES_DE_LA_VERSION_CONGELADA:\n${sinDeclarar.join("\n")}`).toEqual([]);
    const yaNoLeen = [...RUTAS_CLASIFICADAS].filter((n) => !encontrados.has(n));
    expect(yaNoLeen, `Estos ya no leen la versión congelada: sacalos de la lista:\n${yaNoLeen.join("\n")}`).toEqual([]);
  });

  describe("el detector (con datos sintéticos)", () => {
    it("ve una lectura directa, unas versiones anidadas y el SQL crudo; no un comentario", () => {
      expect(eligeLaVersionPorSuCuenta("await tx.versionDeOpcion.findMany({})")).toBe(true);
      expect(eligeLaVersionPorSuCuenta("opciones: { select: { versiones:\n { take: 1 } } }")).toBe(true);
      expect(eligeLaVersionPorSuCuenta('tx.$queryRaw`SELECT * FROM "VersionDeOpcion"`')).toBe(true);
      expect(eligeLaVersionPorSuCuenta("// tx.versionDeOpcion.findMany({})")).toBe(false);
      expect(necesitaClasificacion("opcionesElegidas: { select: { versionDeOpcion: { select: { consumos: true } } } }")).toBe(true);
      expect(necesitaClasificacion("versionDeOpcionId: true")).toBe(false);
    });
  });
});
