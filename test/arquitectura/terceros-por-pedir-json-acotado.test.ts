import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-18 (S-30): todo pedido de `src/` a un tercero por HTTP pasa por UNA puerta, `pedirJsonAcotado` (`server/adaptadores/pedir-json-acotado.ts`), que fija https, host de una lista
 * cerrada, `redirect: "error"`, tope de tiempo y tope de tamaño. Lo que traen las APIs externas (el dólar, el IPC) termina en tablas globales que leen todas las empresas: un
 * `fetch(` suelto en un adaptador nuevo vuelve a leer la respuesta entera, a seguir un 302 hacia otro host y a creer cualquier fecha o tamaño.
 *  1. El único `fetch(` de `src/` y `plataforma/src/` es el del helper.
 *  2. Ese `fetch` lleva `redirect: "error"`.
 *  3. `pedirJsonAcotado` solo se llama desde `server/adaptadores/`, siempre con un objeto literal que declara `hostsPermitidos` y `maxBytes`.
 * Un `fetch` legítimo nuevo (por ejemplo, desde el navegador a la propia app) se declara en `FETCH_PERMITIDOS` con su motivo.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma/src"];
const HELPER = "src/server/adaptadores/pedir-json-acotado.ts";
const CARPETA_DE_ADAPTADORES = "src/server/adaptadores/";

/** archivo → cuántos `fetch(` tiene y por qué. */
const FETCH_PERMITIDOS: Record<string, { cuantos: number; motivo: string }> = {
  [HELPER]: { cuantos: 1, motivo: "la puerta única: https, host fijo, sin redirecciones, con tope de tamaño y de tiempo" },
};

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const fuenteDe = (codigo: string) => ts.createSourceFile("archivo.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Las llamadas `fetch(...)`, `globalThis.fetch(...)`, `window.fetch(...)` y `self.fetch(...)`. */
function llamadasAFetch(codigo: string): ts.CallExpression[] {
  const llamadas: ts.CallExpression[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const f = n.expression;
      const esFetch = (ts.isIdentifier(f) && f.text === "fetch") || (ts.isPropertyAccessExpression(f) && f.name.text === "fetch" && ts.isIdentifier(f.expression) && ["globalThis", "window", "self"].includes(f.expression.text));
      if (esFetch) llamadas.push(n);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuenteDe(codigo));
  return llamadas;
}

/** Las propiedades del objeto literal que se pasa como `posicion`-ésimo argumento; `null` si no es un objeto literal. */
function propiedadesDelArgumento(llamada: ts.CallExpression, posicion: number): Map<string, string> | null {
  const arg = llamada.arguments[posicion];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const sf = llamada.getSourceFile();
  const props = new Map<string, string>();
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p)) props.set(p.name.getText(sf), p.initializer.getText(sf));
    else if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.text, p.name.text);
  }
  return props;
}

function llamadasAlHelper(codigo: string): ts.CallExpression[] {
  const llamadas: ts.CallExpression[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "pedirJsonAcotado") llamadas.push(n);
    ts.forEachChild(n, visitar);
  };
  visitar(fuenteDe(codigo));
  return llamadas;
}

const todos = () => CARPETAS.flatMap((c) => archivos(join(RAIZ, c))).map((a) => ({ rel: relative(RAIZ, a).replace(/\\/g, "/"), codigo: readFileSync(a, "utf8") }));

describe("GT-18: los pedidos a terceros pasan por pedirJsonAcotado", () => {
  it("el detector ve un `fetch(` suelto y una llamada al helper sin tope (sanidad: no pasa en vacío)", () => {
    expect(llamadasAFetch(`async function f() { return fetch(url); }`)).toHaveLength(1);
    expect(llamadasAFetch(`const r = await globalThis.fetch(url, { redirect: "error" });`)).toHaveLength(1);
    expect(llamadasAFetch(`const o = { fetch: 1 }; o.fetch;`)).toHaveLength(0);
    const sinTope = llamadasAlHelper(`pedirJsonAcotado(URL, { hostsPermitidos: ["a.test"] });`)[0];
    expect([...propiedadesDelArgumento(sinTope, 1)!.keys()]).toEqual(["hostsPermitidos"]);
    expect(llamadasAlHelper(`pedirJsonAcotado(URL, opciones);`).map((l) => propiedadesDelArgumento(l, 1))).toEqual([null]);
  });

  it("los únicos `fetch(` de src/ y plataforma/src/ son los de la lista cerrada, con la cuenta exacta", () => {
    const cuenta: Record<string, number> = {};
    for (const { rel, codigo } of todos()) {
      const n = llamadasAFetch(codigo).length;
      if (n > 0) cuenta[rel] = n;
    }
    const esperado = Object.fromEntries(Object.entries(FETCH_PERMITIDOS).map(([k, v]) => [k, v.cuantos]));
    expect(cuenta, "un pedido a un tercero va por pedirJsonAcotado (server/adaptadores/); un fetch nuevo legítimo se declara en FETCH_PERMITIDOS con su motivo").toEqual(esperado);
  });

  it("el `fetch` del helper lleva `redirect: \"error\"`", () => {
    const codigo = todos().find((f) => f.rel === HELPER)!.codigo;
    const [llamada] = llamadasAFetch(codigo);
    expect(propiedadesDelArgumento(llamada, 1)?.get("redirect")).toBe('"error"');
  });

  it("`pedirJsonAcotado` solo se llama desde server/adaptadores/, con hostsPermitidos y maxBytes declarados en un objeto literal", () => {
    let vistas = 0;
    for (const { rel, codigo } of todos()) {
      if (rel === HELPER) continue;
      for (const llamada of llamadasAlHelper(codigo)) {
        vistas++;
        expect(rel.startsWith(CARPETA_DE_ADAPTADORES), `${rel}: el helper se usa solo desde ${CARPETA_DE_ADAPTADORES}`).toBe(true);
        const props = propiedadesDelArgumento(llamada, 1);
        expect(props, `${rel}: las opciones van como objeto literal`).not.toBeNull();
        expect(props!.has("hostsPermitidos"), `${rel}: falta hostsPermitidos`).toBe(true);
        expect(props!.has("maxBytes"), `${rel}: falta maxBytes`).toBe(true);
      }
    }
    expect(vistas, "los adaptadores del dólar (3) y del IPC (1)").toBe(4);
  });
});
