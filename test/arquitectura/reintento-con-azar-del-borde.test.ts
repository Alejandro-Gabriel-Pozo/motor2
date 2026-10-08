import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Todo `conReintento(…)` fuera del núcleo del reintento le pasa la fuente de azar del borde (`aleatorio`) (auditoría independiente del Hito 1 de la rama `pureza-integracion`).
 *
 * El jitter de la espera entre dos intentos usa una fuente de azar INYECTADA (Pureza 1.5): `conTransaccionSerializable` (`src/lib/transaccion-serializable.ts`) la toma de `transaccion.aleatorio`, que la pone el borde que crea la
 * transacción (`core/auth/base.ts`). Pero un caso de uso que arma su PROPIO bucle con `conReintento` directo —hoy `guardar-version-de-receta.ts`, que reintenta el choque del UNIQUE
 * `(productoId, version)`— no pasa por esa vía: si no pasa `aleatorio`, la espera cae en la mitad del techo, igual para todos los que chocan a la vez, y vuelven a chocar en bloque. Esta regla
 * obliga a pasar `aleatorio` en cada llamada (o a la excepción, con motivo).
 */
const RAIZ = join(__dirname, "..", "..");
const EXCEPCIONES: Record<string, string> = {};

/** Las llamadas a `conReintento(…)` de un archivo y si su segundo argumento (la configuración) trae la clave `aleatorio`. */
export function llamadasAConReintento(codigo: string): { linea: number; conAleatorio: boolean }[] {
  const archivo = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const salida: { linea: number; conAleatorio: boolean }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "conReintento") {
      const config = n.arguments[1];
      const conAleatorio =
        !!config &&
        ts.isObjectLiteralExpression(config) &&
        config.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === "aleatorio");
      salida.push({ linea: archivo.getLineAndCharacterOfPosition(n.getStart(archivo)).line + 1, conAleatorio });
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

describe("el detector de conReintento con y sin aleatorio", () => {
  it("ve la clave aleatorio en la configuración, y su ausencia", () => {
    expect(llamadasAConReintento("await conReintento(op, { maxIntentos: 5, aleatorio: actor.transaccion.aleatorio });")).toEqual([{ linea: 1, conAleatorio: true }]);
    expect(llamadasAConReintento("await conReintento(op, { maxIntentos: 5, aleatorio });")).toEqual([{ linea: 1, conAleatorio: true }]);
    expect(llamadasAConReintento("await conReintento(op, { maxIntentos: 5 });")).toEqual([{ linea: 1, conAleatorio: false }]);
    expect(llamadasAConReintento("await conReintento(op, config);")).toEqual([{ linea: 1, conAleatorio: false }]); // una configuración que no se puede leer falla cerrado
    expect(llamadasAConReintento("await otraCosa(op, { maxIntentos: 5 });")).toEqual([]);
  });
});

describe("ninguna llamada a conReintento fuera del núcleo del reintento omite el azar del borde", () => {
  const todos = ["src", "plataforma/src"].flatMap((c) => archivos(join(RAIZ, c))).map((a) => relative(RAIZ, a).split(sep).join("/"));

  it("las llamadas fuera de core/movimientos pasan `aleatorio` (salvo excepciones con motivo, revisadas en las dos direcciones)", () => {
    const sinAzar = todos
      .filter((ruta) => !ruta.startsWith("src/core/movimientos/"))
      .flatMap((ruta) => llamadasAConReintento(readFileSync(join(RAIZ, ruta), "utf8")).filter((l) => !l.conAleatorio).map((l) => `${ruta}:${l.linea}`))
      .filter((ruta) => !(ruta.split(":")[0] in EXCEPCIONES));
    expect(sinAzar, `Pasá \`aleatorio: actor.transaccion.aleatorio\` a conReintento (el jitter usa la fuente de azar del borde):\n${sinAzar.join("\n")}`).toEqual([]);
    const sobran = Object.keys(EXCEPCIONES).filter((ruta) => !todos.includes(ruta) || llamadasAConReintento(readFileSync(join(RAIZ, ruta), "utf8")).every((l) => l.conAleatorio));
    expect(sobran).toEqual([]);
  });

  it("encuentra al menos una llamada real (si no, la regla no mira nada)", () => {
    const total = todos.filter((ruta) => !ruta.startsWith("src/core/movimientos/")).flatMap((ruta) => llamadasAConReintento(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(total.length).toBeGreaterThanOrEqual(1);
  });
});
