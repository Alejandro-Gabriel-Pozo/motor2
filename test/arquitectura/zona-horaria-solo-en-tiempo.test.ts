import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: ninguna zona horaria escrita a mano fuera de `src/core/tiempo/`. Formatear una hora, saber a qué día pertenece un
 * instante y calcular los límites de un día se hace con `core/tiempo/zona-horaria.ts` y la zona de la empresa (`Empresa.zonaHoraria`). Si cada
 * pantalla arma su offset («-03:00», `3 * 60 * 60 * 1000`) o su `timeZone: "America/…"`, el día en que entre una empresa de otra zona hay
 * que reabrir todos esos lugares (y un día de horario de verano dura 23 o 25 horas: un offset fijo no alcanza).
 *
 * Se mira el AST (los comentarios no cuentan) de todo `src/` salvo `core/tiempo/`. No hay excepciones: si una pantalla necesita algo que
 * `core/tiempo` no ofrece, se agrega ahí.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETA_TIEMPO = "core/tiempo/";

const NOMBRE_IANA = /\b(?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian|Antarctica|Etc)\/[A-Za-z_+-]*/;
const OFFSET_EN_TEXTO = /\d[+-]\d{2}:\d{2}/;
const LLAMADAS_PROHIBIDAS = new Set(["setUTCHours", "setHours"]);
const OFFSET_ARGENTINA_EN_MS = "3*60*60*1000";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Lo que el fuente hace con una zona a mano, como «línea: qué». Vacío si no hay nada. */
export function zonasAMano(fuente: string): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const hallazgos: string[] = [];
  const linea = (nodo: ts.Node) => sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1;
  const texto = (nodo: ts.Node, valor: string) => {
    if (NOMBRE_IANA.test(valor)) hallazgos.push(`${linea(nodo)}: nombre de zona IANA escrito a mano («${valor.trim().slice(0, 40)}»)`);
    else if (OFFSET_EN_TEXTO.test(valor)) hallazgos.push(`${linea(nodo)}: offset horario escrito a mano («${valor.trim().slice(0, 40)}»)`);
  };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) texto(nodo, nodo.text);
    else if (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) texto(nodo, nodo.text);
    else if (ts.isPropertyAssignment(nodo) || ts.isShorthandPropertyAssignment(nodo)) {
      if (nodo.name.getText(sf) === "timeZone") hallazgos.push(`${linea(nodo)}: opción \`timeZone\` escrita a mano`);
    } else if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && LLAMADAS_PROHIBIDAS.has(nodo.expression.name.text)) {
      hallazgos.push(`${linea(nodo)}: \`.${nodo.expression.name.text}(\` fuera de core/tiempo`);
    } else if (ts.isBinaryExpression(nodo) && nodo.getText(sf).replace(/\s+/g, "") === OFFSET_ARGENTINA_EN_MS) {
      hallazgos.push(`${linea(nodo)}: offset de Argentina en milisegundos escrito a mano`);
    } else if (ts.isNumericLiteral(nodo) && nodo.text === "10800000") {
      hallazgos.push(`${linea(nodo)}: offset de Argentina en milisegundos escrito a mano`);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return hallazgos;
}

describe("zona horaria: solo en core/tiempo", () => {
  const encontrados = archivos(RAIZ)
    .map((ruta) => relative(RAIZ, ruta).split(sep).join("/"))
    .filter((ruta) => !ruta.startsWith(CARPETA_TIEMPO))
    .map((ruta) => [ruta, zonasAMano(readFileSync(join(RAIZ, ruta), "utf8"))] as const)
    .filter(([, h]) => h.length > 0);

  it("ningún archivo de src/ fuera de core/tiempo escribe una zona, un offset o `timeZone:` a mano", () => {
    expect(encontrados.map(([ruta, h]) => `${ruta}: ${h.join(" | ")}`)).toEqual([]);
  });

  it("sanidad: el módulo de tiempo existe (la regla mira un src/ real) y SÍ tiene zonas escritas, que es justo lo permitido", () => {
    const propio = readFileSync(join(RAIZ, CARPETA_TIEMPO, "zona-horaria.ts"), "utf8");
    expect(zonasAMano(propio).length).toBeGreaterThan(0);
  });
});

describe("zonasAMano: el detector detecta lo que dice detectar", () => {
  it("nombre IANA en un literal o en un template", () => {
    expect(zonasAMano('const z = "America/Argentina/Buenos_Aires";')).toHaveLength(1);
    expect(zonasAMano("const z = `Europe/Madrid`;")).toHaveLength(1);
    expect(zonasAMano("const z = `Asia/${x}`;")).toHaveLength(1);
  });

  it("opción `timeZone` en un objeto, con cualquier valor", () => {
    expect(zonasAMano("new Intl.DateTimeFormat('es-AR', { timeZone: zona });")).toHaveLength(1);
    expect(zonasAMano("toLocaleString('es-AR', { timeZone });")).toHaveLength(1);
  });

  it("offset en un texto, como `T00:00:00.000-03:00`", () => {
    expect(zonasAMano("new Date(`${dia}T00:00:00.000-03:00`);")).toHaveLength(1);
    expect(zonasAMano('new Date("2026-09-26T00:00:00+05:30");')).toHaveLength(1);
  });

  it("`.setUTCHours(` y `.setHours(`", () => {
    expect(zonasAMano("d.setUTCHours(0, 0, 0, 0);")).toHaveLength(1);
    expect(zonasAMano("d.setHours(23, 59, 59, 999);")).toHaveLength(1);
  });

  it("el offset de Argentina en milisegundos, escrito de cualquiera de las dos formas", () => {
    expect(zonasAMano("const MS = 3 * 60 * 60 * 1000;")).toHaveLength(1);
    expect(zonasAMano("const MS = 10800000;")).toHaveLength(1);
  });

  it("no marca lo que no es una zona: comentarios, horas sueltas, fechas ISO con Z, otros números", () => {
    expect(zonasAMano("// America/Argentina/Buenos_Aires y 3 * 60 * 60 * 1000\nconst x = 1;")).toEqual([]);
    expect(zonasAMano('const h = "09:30"; const f = "2026-09-26T00:00:00.000Z";')).toEqual([]);
    expect(zonasAMano("const MS_DIA = 24 * 60 * 60 * 1000; const rango = '2026-01-01-2026-12-31';")).toEqual([]);
    expect(zonasAMano("setUTCDate(d.getUTCDate() - 1);")).toEqual([]);
    expect(zonasAMano("new Date().getTimezoneOffset();")).toEqual([]); // la zona del navegador (excel.ts) es otro tema: no es una zona escrita a mano
  });
});
