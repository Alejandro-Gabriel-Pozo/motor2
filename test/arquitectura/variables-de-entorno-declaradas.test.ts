import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CLAVES_DE_ENTORNO_DECLARADAS } from "../../src/env";

/**
 * Toda variable de entorno que lee el código tiene que estar declarada en el schema de `src/env.ts` o inventariada acá con su motivo.
 *
 * El schema es lo que valida el arranque de Producción (`validarEntornoAlArrancar`): una variable que el código lee y el schema no conoce
 * puede faltar o venir mal en producción sin que nada avise, y la feature que depende de ella se rompe en silencio. Una variable nueva
 * obliga a decidir: declararla en el schema (requerida u opcional) o inventariarla acá, explicando por qué no se valida.
 */

const RAIZ = join(__dirname, "../..");

/** Variables que el código lee y que NO se validan en el schema, cada una con el motivo. */
const FUERA_DEL_SCHEMA: Record<string, string> = {
  NODE_ENV: "la fija Next.js/Node, nunca el operador",
  NEXT_RUNTIME: "la fija Next.js según el runtime que ejecuta el archivo",
  VERCEL: "la fija Vercel; solo decide si se sirve por https",
  VERCEL_ENV: "la fija Vercel; es la que decide si el schema se aplica al arrancar",
  MOTOR2_SIN_DOLAR_AUTOMATICO: "flag de pruebas de navegador (no salir a internet); no es configuración de la app",
};

function archivosDeCodigo(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivosDeCodigo(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const NOMBRES_DE_ENTORNO_COMO_PARAMETRO = new Set(["env", "source"]);

/** Variables leídas: `process.env.X`, `process.env["X"]` y `env.X`/`source.X` (el entorno que se pasa entero a una función). */
function variablesLeidas(codigo: string): string[] {
  const fuente = ts.createSourceFile("archivo.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nombres = new Set<string>();
  const esProcessEnv = (e: ts.Expression) =>
    ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "env";
  const visitar = (nodo: ts.Node) => {
    if (ts.isPropertyAccessExpression(nodo)) {
      if (esProcessEnv(nodo.expression)) nombres.add(nodo.name.text);
      else if (ts.isIdentifier(nodo.expression) && NOMBRES_DE_ENTORNO_COMO_PARAMETRO.has(nodo.expression.text) && /^[A-Z][A-Z0-9_]+$/.test(nodo.name.text)) {
        nombres.add(nodo.name.text);
      }
    } else if (ts.isElementAccessExpression(nodo) && esProcessEnv(nodo.expression) && ts.isStringLiteralLike(nodo.argumentExpression)) {
      nombres.add(nodo.argumentExpression.text);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return [...nombres];
}

function leidasPorArchivo(): Map<string, string[]> {
  const archivos = [...archivosDeCodigo(join(RAIZ, "src")), join(RAIZ, "next.config.ts"), join(RAIZ, "prisma.config.ts")];
  const porArchivo = new Map<string, string[]>();
  for (const a of archivos) {
    const variables = variablesLeidas(readFileSync(a, "utf8"));
    if (variables.length > 0) porArchivo.set(relative(RAIZ, a).replace(/\\/g, "/"), variables);
  }
  return porArchivo;
}

describe("variables de entorno: lo que el código lee está declarado en el schema o inventariado", () => {
  const leidas = leidasPorArchivo();
  const todas = new Set([...leidas.values()].flat());
  const declaradas = new Set(CLAVES_DE_ENTORNO_DECLARADAS);

  it("el detector ve las variables de verdad (sanidad: no pasa en vacío)", () => {
    for (const esperada of ["DATABASE_URL", "CRON_SECRET", "CARTA_DOMINIO_BASE", "NODE_ENV", "AUTH_URL", "MOTOR2_ROL_ESTRICTO"]) {
      expect(todas.has(esperada), esperada).toBe(true);
    }
    expect(variablesLeidas(`const a = process.env["ALGO_NUEVO"]; const b = process.env.OTRA; sirve(env.MAS_UNA); const c = otro.NO_ES;`).sort()).toEqual(["ALGO_NUEVO", "MAS_UNA", "OTRA"]);
  });

  it("toda variable que el código lee está en el schema de src/env.ts o en FUERA_DEL_SCHEMA", () => {
    const sinDeclarar = [...leidas.entries()]
      .flatMap(([archivo, variables]) => variables.filter((v) => !declaradas.has(v) && !(v in FUERA_DEL_SCHEMA)).map((v) => `${v} (en ${archivo})`))
      .sort();
    expect(sinDeclarar, "variables leídas sin declarar: agregarlas al schema de src/env.ts (requerida u opcional) o a FUERA_DEL_SCHEMA con motivo").toEqual([]);
  });

  it("FUERA_DEL_SCHEMA no tiene entradas viejas, repetidas con el schema ni sin motivo", () => {
    for (const [variable, motivo] of Object.entries(FUERA_DEL_SCHEMA)) {
      expect(todas.has(variable), `"${variable}" ya no se lee en el código: sacala de FUERA_DEL_SCHEMA`).toBe(true);
      expect(declaradas.has(variable), `"${variable}" ya está en el schema: sacala de FUERA_DEL_SCHEMA`).toBe(false);
      expect(motivo.trim().length, `"${variable}" sin motivo`).toBeGreaterThan(10);
    }
  });

  it("toda variable declarada en el schema se lee en algún lado del código (no hay declaraciones muertas)", () => {
    const sinUso = [...declaradas].filter((v) => !todas.has(v) && !["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"].includes(v));
    expect(sinUso, "declaradas en el schema que ningún archivo lee").toEqual([]);
  });
});
