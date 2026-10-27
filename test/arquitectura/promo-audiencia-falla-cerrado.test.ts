import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Interruptor «solo salón» de las promos (docs/diseno-promo-solo-salon-2026-10-26.md, paso 3): la AUDIENCIA con la que se leen las promos se decide en pocos lugares y FALLA CERRADO. Por AST y sin base (el comportamiento contra
 * Postgres es de `test/carta/promo-solo-salon-filtro.test.ts`). Fija la FORMA del código:
 *
 *  1. La ENTRADA PÚBLICA (`lecturas/carta/publica.ts`, `server/carta-publica/`, `app/(carta-publica)/`, `components/carta-publica/`) no contiene la audiencia del salón: ningún literal `"salon"`. Una carta pública no puede pedir las promos
 *     de «solo salón», ni por error ni por un cambio de último momento.
 *  2. Toda llamada a `wherePromoOfrecidaEn` lleva la audiencia (dos argumentos: es obligatoria, no hay valor por defecto) y el literal `"salon"` solo lo pasan los lectores del salón (la lista cerrada de abajo: el selector del POS, la promo para
 *     agregar a la cuenta y el contador del hub). Pedirla desde otro archivo es un cambio de diseño que se declara acá, a propósito.
 *  3. `resolverMenuCarta` / `resolverMenuCartaConDiagnostico` (`lecturas/carta/menu.ts`) declaran la audiencia de las promos con el valor por defecto `"publico"` (el default es el público: quien olvide pasarla ve menos, nunca más), y solo el selector
 *     del POS les pide `"salon"`.
 *  4. `wherePromoOfrecidaEn` (el embudo) trata como público todo lo que no sea exactamente `"salon"` (falla cerrado ante un valor inesperado).
 *
 * Mutaciones (rojo → revertido editando; también como casos sintéticos abajo): un `"salon"` en `publica.ts`; quitar el segundo argumento de una llamada; `"salon"` en un archivo que no es del salón; cambiar el default de `promos` a `"salon"`; invertir
 * la comparación del embudo (`=== "publico"`).
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const EMBUDO = "src/core/carta/promo-sucursal.ts";
const MENU = "src/server/lecturas/carta/menu.ts";
const POS_SELECTOR = "src/server/lecturas/pos/selector-carta.ts";

/** Los archivos del salón: los únicos que pueden pedir `"salon"` (el filtro o el menú). */
const LECTORES_DEL_SALON = [POS_SELECTOR, "src/server/lecturas/pos/promo-para-agregar.ts", "src/server/consultas/carta/mantenimiento.ts"] as const;
/** La parte de la entrada pública que es un archivo suelto; el resto son carpetas. */
const ENTRADA_PUBLICA_ARCHIVOS = ["src/server/lecturas/carta/publica.ts"] as const;
const ENTRADA_PUBLICA_CARPETAS = ["src/server/carta-publica", "src/app/(carta-publica)", "src/components/carta-publica"] as const;

function archivosDe(dir: string): string[] {
  const absoluto = join(RAIZ, dir);
  try {
    return readdirSync(absoluto).flatMap((nombre) => {
      const ruta = join(absoluto, nombre);
      return statSync(ruta).isDirectory() ? archivosDe(relative(RAIZ, ruta)) : /\.tsx?$/.test(nombre) ? [relative(RAIZ, ruta).split(sep).join("/")] : [];
    });
  } catch {
    return [];
  }
}

const fuente = (texto: string) => ts.createSourceFile("x.ts", texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function recorrer(nodo: ts.Node, f: (n: ts.Node) => void): void {
  f(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, f));
}
const esLiteral = (n: ts.Node | undefined, valor: string): boolean => !!n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === valor;
const llamaA = (n: ts.Node, nombre: string): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre;

/** ¿El fuente contiene el literal `"salon"` (en código: un comentario no cuenta)? */
function contieneLaAudienciaDelSalon(texto: string): boolean {
  let hay = false;
  recorrer(fuente(texto), (n) => {
    if (esLiteral(n, "salon")) hay = true;
  });
  return hay;
}

/** Los problemas de las llamadas a `wherePromoOfrecidaEn` de un fuente (vacío = bien). */
function problemasDeLasLlamadas(texto: string): string[] {
  const problemas: string[] = [];
  recorrer(fuente(texto), (n) => {
    if (llamaA(n, "wherePromoOfrecidaEn") && n.arguments.length !== 2) problemas.push("wherePromoOfrecidaEn sin la audiencia (segundo argumento obligatorio)");
  });
  return problemas;
}

/** El valor por defecto del parámetro `promos` de cada una de las dos lecturas de la carta (`undefined` si falta la función o el parámetro). */
function defaultsDeLaAudiencia(texto: string): Record<string, string | undefined> {
  const salida: Record<string, string | undefined> = {};
  for (const s of fuente(texto).statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !["resolverMenuCarta", "resolverMenuCartaConDiagnostico"].includes(s.name.text)) continue;
    const p = s.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === "promos");
    salida[s.name.text] = p?.initializer && ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined;
  }
  return salida;
}

/** Los archivos (de la lista dada) que le piden `"salon"` a una lectura de promos: el filtro o el menú. */
function pideElSalon(texto: string): boolean {
  let pide = false;
  recorrer(fuente(texto), (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return;
    if (["wherePromoOfrecidaEn", "resolverMenuCarta", "resolverMenuCartaConDiagnostico"].includes(n.expression.text) && n.arguments.some((a) => esLiteral(a, "salon"))) pide = true;
  });
  return pide;
}

/** Lo que hace el embudo con la audiencia: ¿sale con `soloSalon: false` todo lo que no sea exactamente `"salon"`? (se mira que compare con `"salon"` y no con `"publico"`). */
function embudoFallaCerrado(texto: string): boolean {
  const sf = fuente(texto);
  const funcion = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "wherePromoOfrecidaEn");
  if (!funcion) return false;
  let ok = false;
  recorrer(funcion, (n) => {
    // `audiencia === "salon" ? <criterio de siempre> : { ...criterio, soloSalon: false }`
    if (ts.isConditionalExpression(n) && ts.isBinaryExpression(n.condition) && n.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && esLiteral(n.condition.right, "salon")) {
      const rama = n.whenFalse.getText(sf);
      ok = /soloSalon\s*:\s*false/.test(rama) && !/soloSalon/.test(n.whenTrue.getText(sf));
    }
  });
  return ok;
}

describe("promos: la audiencia falla cerrado", () => {
  const entradaPublica = [...ENTRADA_PUBLICA_ARCHIVOS, ...ENTRADA_PUBLICA_CARPETAS.flatMap(archivosDe)];
  const todosLosFuentes = archivosDe("src");

  it("encuentra la entrada pública (no quedó vacía) y el embudo", () => {
    expect(entradaPublica.length).toBeGreaterThan(5);
    expect(entradaPublica).toContain("src/server/carta-publica/sin-sesion.ts");
    expect(entradaPublica.some((r) => r.startsWith("src/app/(carta-publica)/"))).toBe(true);
    expect(todosLosFuentes).toContain(EMBUDO);
  });

  it("1. ningún archivo de la entrada pública contiene la audiencia del salón", () => {
    const malos = entradaPublica.filter((ruta) => contieneLaAudienciaDelSalon(leer(ruta)));
    expect(malos, `La carta pública no puede pedir las promos de «solo salón»:\n${malos.join("\n")}`).toEqual([]);
  });

  it("2. toda llamada a wherePromoOfrecidaEn lleva la audiencia, y solo los lectores del salón le piden el salón", () => {
    const sinAudiencia = todosLosFuentes.flatMap((ruta) => problemasDeLasLlamadas(leer(ruta)).map((p) => `${ruta}: ${p}`));
    expect(sinAudiencia).toEqual([]);
    const piden = todosLosFuentes.filter((ruta) => pideElSalon(leer(ruta))).sort();
    expect(piden, "los únicos archivos que piden las promos del salón (si es otro, es un cambio de diseño: se declara acá)").toEqual([...LECTORES_DEL_SALON].sort());
  });

  it("3. el menú de la carta declara la audiencia con el valor por defecto «publico», y el POS le pide el salón", () => {
    expect(defaultsDeLaAudiencia(leer(MENU))).toEqual({ resolverMenuCarta: "publico", resolverMenuCartaConDiagnostico: "publico" });
    expect(pideElSalon(leer(POS_SELECTOR))).toBe(true);
  });

  it("4. el embudo trata como público todo lo que no sea exactamente «salon»", () => {
    expect(embudoFallaCerrado(leer(EMBUDO))).toBe(true);
  });

  describe("el propio guardián (mutaciones sintéticas sobre los archivos reales)", () => {
    const mutar = (texto: string, de: string, a: string) => {
      expect(texto, `la mutación «${de}» tiene que existir en el archivo`).toContain(de);
      return texto.replace(de, a);
    };

    it("ve un «salon» en la entrada pública, pero no en un comentario", () => {
      const publica = leer("src/server/lecturas/carta/publica.ts");
      expect(contieneLaAudienciaDelSalon(publica)).toBe(false);
      expect(contieneLaAudienciaDelSalon(mutar(publica, 'conPromos ? "publico" : "ninguna"', 'conPromos ? "salon" : "ninguna"'))).toBe(true);
      expect(contieneLaAudienciaDelSalon("// pasa \"salon\" al POS\nexport const x = 1;")).toBe(false);
      expect(contieneLaAudienciaDelSalon("export const x = `salon`;")).toBe(true);
    });

    it("ve una llamada sin audiencia y un archivo que no es del salón pidiéndola", () => {
      const pos = leer(POS_SELECTOR);
      expect(problemasDeLasLlamadas(pos)).toEqual([]);
      expect(problemasDeLasLlamadas(mutar(pos, 'wherePromoOfrecidaEn(sucursalId, "salon"), cupos: { some: { activo: true } }', "wherePromoOfrecidaEn(sucursalId), cupos: { some: { activo: true } }"))).not.toEqual([]);
      expect(pideElSalon('export const f = () => wherePromoOfrecidaEn(sucursalId, "salon");')).toBe(true);
      expect(pideElSalon('export const f = () => resolverMenuCarta(sucursalId, db, ahora, undefined, "salon");')).toBe(true);
      expect(pideElSalon('export const f = () => resolverMenuCarta(sucursalId, db, ahora);')).toBe(false);
    });

    it("ve que el default de la audiencia deje de ser «publico» y que el embudo se abra", () => {
      const menu = leer(MENU);
      expect(defaultsDeLaAudiencia(mutar(menu, 'promos: AudienciaDePromo | "ninguna" = "publico",\n  /** GO-2d: ver', 'promos: AudienciaDePromo | "ninguna" = "salon",\n  /** GO-2d: ver'))).toEqual({ resolverMenuCarta: "salon", resolverMenuCartaConDiagnostico: "publico" });
      expect(defaultsDeLaAudiencia(mutar(menu, 'promos: AudienciaDePromo | "ninguna" = "publico",\n  /**\n   * GO-2d', 'promos: AudienciaDePromo | "ninguna",\n  /**\n   * GO-2d'))).toMatchObject({ resolverMenuCartaConDiagnostico: undefined });
      const embudo = leer(EMBUDO);
      expect(embudoFallaCerrado(mutar(embudo, 'audiencia === "salon" ? ofrecida : ({ ...ofrecida, soloSalon: false } as const)', 'audiencia === "publico" ? ({ ...ofrecida, soloSalon: false } as const) : ofrecida'))).toBe(false);
      expect(embudoFallaCerrado(mutar(embudo, '({ ...ofrecida, soloSalon: false } as const)', "ofrecida"))).toBe(false);
    });
  });
});
