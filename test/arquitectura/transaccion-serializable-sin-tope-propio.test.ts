import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Ninguna llamada a `conTransaccionSerializable(…)` fija su propio `maxIntentos` (tercer argumento): usa el default de `src/lib/transaccion-serializable.ts`.
 *
 * Por qué (flake de la REGRESIÓN C2, 2026-10-22). O.249 encendió `tambienChoqueDeUnico` (quinto argumento) en `registrarMovimiento`, `registrarVenta`, `reclasificarStock` y `aceptarTraspaso`
 * escribiendo `, 5, {}, true` —5 era el default de entonces—, igual que ya lo hacían el reingreso de traspaso y el ticket corregido. Al día siguiente O.350 subió el default a 8 (los contendientes
 * de SERIALIZABLE se resuelven de a uno por ronda y 5 no alcanzaba bajo carga) y esas seis llamadas se quedaron con el 5 fijo sin que nadie lo notara: la venta siguió agotando los reintentos con
 * dos ventas simultáneas. Para llegar al quinto argumento sin fijar el tope se pasa `undefined` (`, undefined, undefined, true`), como el resto de los casos de uso.
 *
 * Un tope propio legítimo (si alguna vez hace falta) va en EXCEPCIONES con su motivo; la regla se revisa en las dos direcciones.
 */
const RAIZ = join(__dirname, "..", "..");
const EXCEPCIONES: Record<string, string> = {};

/** Las llamadas a `conTransaccionSerializable(…)` de un archivo cuyo tercer argumento existe y no es `undefined`, con su texto. */
export function llamadasConTopePropio(codigo: string): { linea: number; tope: string }[] {
  const archivo = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const salida: { linea: number; tope: string }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "conTransaccionSerializable") {
      const tope = n.arguments[2];
      if (tope && !(ts.isIdentifier(tope) && tope.text === "undefined")) {
        salida.push({ linea: archivo.getLineAndCharacterOfPosition(n.getStart(archivo)).line + 1, tope: tope.getText(archivo) });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(archivo);
  return salida;
}

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe("el detector de conTransaccionSerializable con tope propio", () => {
  it("ve un tercer argumento fijo y deja pasar la ausencia o `undefined`", () => {
    expect(llamadasConTopePropio("await conTransaccionSerializable(t, fn, 5, {}, true);")).toEqual([{ linea: 1, tope: "5" }]);
    expect(llamadasConTopePropio("await conTransaccionSerializable(t, fn, intentos);")).toEqual([{ linea: 1, tope: "intentos" }]);
    expect(llamadasConTopePropio("await conTransaccionSerializable(t, fn, undefined, undefined, true);")).toEqual([]);
    expect(llamadasConTopePropio("await conTransaccionSerializable(t, fn);")).toEqual([]);
    expect(llamadasConTopePropio("await otraCosa(t, fn, 5);")).toEqual([]);
  });
});

describe("ninguna llamada a conTransaccionSerializable fija su propio maxIntentos", () => {
  const todos = ["src", "plataforma/src"].flatMap((c) => archivos(join(RAIZ, c))).map((a) => relative(RAIZ, a).split(sep).join("/"));

  it("usan el default de src/lib/transaccion-serializable.ts (salvo excepciones con motivo, revisadas en las dos direcciones)", () => {
    const conTope = todos
      .flatMap((ruta) => llamadasConTopePropio(readFileSync(join(RAIZ, ruta), "utf8")).map((l) => `${ruta}:${l.linea} (maxIntentos = ${l.tope})`))
      .filter((l) => !(l.split(":")[0] in EXCEPCIONES));
    expect(conTope, `Pasá \`undefined\` como maxIntentos para usar el default (ver el docstring de conTransaccionSerializable):\n${conTope.join("\n")}`).toEqual([]);
    const sobran = Object.keys(EXCEPCIONES).filter((ruta) => !todos.includes(ruta) || llamadasConTopePropio(readFileSync(join(RAIZ, ruta), "utf8")).length === 0);
    expect(sobran).toEqual([]);
  });

  it("encuentra llamadas reales (si no, la regla no mira nada)", () => {
    const total = todos.filter((ruta) => readFileSync(join(RAIZ, ruta), "utf8").includes("conTransaccionSerializable(")).length;
    expect(total).toBeGreaterThanOrEqual(10);
  });
});
