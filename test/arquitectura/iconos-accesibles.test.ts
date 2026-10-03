import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { GRUPOS_NAV } from "../../src/core/navegacion/estructura";

/**
 * Regla de accesibilidad de los íconos: son decorativos. Se comprueba en el código (AST, no el render):
 *  (a) solo `components/iconos.tsx` importa `lucide-react` (el resto usa sus componentes, que ya vienen ocultos a los lectores de pantalla);
 *  (b) el envoltorio `Icono` de ese archivo lleva `aria-hidden="true"`;
 *  (c) todo `<button>`, `<a>`, `<Link>` o `<EnlaceInterno>` que contiene un ícono tiene texto visible o `aria-label` (un control que
 *      fuera solo el ícono quedaría sin nombre);
 *  (d) cada módulo de `GRUPOS_NAV` tiene su ícono en `ICONO_DE_MODULO`, y no sobra ninguno.
 */
const RAIZ = join(__dirname, "../../src");
const ARCHIVO_DE_ICONOS = "components/iconos.tsx";
const COMPONENTES_ICONO = new Set(["Icono", "IconoDeModulo", "IconoDeAccion", "IconoAyuda"]);
const CONTROLES = new Set(["button", "a", "Link", "EnlaceInterno", "summary"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const fuenteTsx = (fuente: string) => ts.createSourceFile("x.tsx", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function recorrer(nodo: ts.Node, visitar: (n: ts.Node) => void): void {
  visitar(nodo);
  ts.forEachChild(nodo, (hijo) => recorrer(hijo, visitar));
}

function esJsx(n: ts.Node): n is ts.JsxElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
}

function etiqueta(nodo: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(nodo) ? nodo.openingElement.tagName : nodo.tagName).getText();
}

function atributos(nodo: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return ts.isJsxElement(nodo) ? nodo.openingElement.attributes : nodo.attributes;
}

/** (a) ¿El fuente importa `lucide-react` (import estático, dinámico o require)? */
function importaLucide(fuente: string): boolean {
  let importa = false;
  recorrer(fuenteTsx(fuente), (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith("lucide-react")) importa = true;
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteralLike(arg) && arg.text.startsWith("lucide-react")) importa = true;
    }
  });
  return importa;
}

/** (b) ¿La función `Icono` renderiza algún elemento con `aria-hidden="true"`? */
function envoltorioOculta(fuente: string): boolean {
  let oculta = false;
  recorrer(fuenteTsx(fuente), (n) => {
    if (!ts.isFunctionDeclaration(n) || n.name?.text !== "Icono") return;
    recorrer(n, (h) => {
      if (!esJsx(h)) return;
      for (const a of atributos(h).properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText() !== "aria-hidden") continue;
        const v = a.initializer;
        if (v && ts.isStringLiteral(v) && v.text === "true") oculta = true;
        if (v && ts.isJsxExpression(v) && v.expression?.kind === ts.SyntaxKind.TrueKeyword) oculta = true;
      }
    });
  });
  return oculta;
}

/** (c) Los controles con un ícono que no tienen texto visible ni `aria-label`: devuelve `etiqueta@línea`. */
function controlesConIconoSinNombre(fuente: string): string[] {
  const sf = fuenteTsx(fuente);
  const malos: string[] = [];
  const contieneIcono = (nodo: ts.Node) => {
    let hay = false;
    recorrer(nodo, (h) => {
      if (esJsx(h) && COMPONENTES_ICONO.has(etiqueta(h))) hay = true;
    });
    return hay;
  };
  recorrer(sf, (n) => {
    if (!ts.isJsxElement(n) || !CONTROLES.has(etiqueta(n)) || !contieneIcono(n)) return;
    if (n.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "aria-label")) return;
    let hayTexto = false;
    recorrer(n, (h) => {
      if (ts.isJsxText(h) && h.text.trim() !== "") hayTexto = true;
      // `{expresion}` hijo (no un atributo) cuenta como texto, salvo que sea un ícono (`{abierto && <IconoDeModulo />}`).
      if (ts.isJsxExpression(h) && ts.isJsxElement(h.parent) && h.expression && !contieneIcono(h.expression)) hayTexto = true;
    });
    if (!hayTexto) malos.push(`${etiqueta(n)}@${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
  });
  return malos;
}

/** (d) Las claves del objeto `ICONO_DE_MODULO`. */
function clavesDeIconos(fuente: string): string[] {
  const claves: string[] = [];
  recorrer(fuenteTsx(fuente), (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText() === "ICONO_DE_MODULO" && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p)) claves.push(p.name.getText().replace(/^["']|["']$/g, ""));
    }
  });
  return claves;
}

describe("íconos accesibles", () => {
  const rutas = archivos(RAIZ);
  const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
  const fuenteDeIconos = () => readFileSync(join(RAIZ, ARCHIVO_DE_ICONOS), "utf8");

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("(a) solo components/iconos.tsx importa lucide-react", () => {
    const importan = rutas.filter((r) => importaLucide(readFileSync(r, "utf8"))).map(nombreDe);
    expect(importan, "importar los íconos desde @/components/iconos, no desde lucide-react").toEqual([ARCHIVO_DE_ICONOS]);
  });

  it("(b) el envoltorio Icono oculta el ícono a los lectores de pantalla", () => {
    expect(envoltorioOculta(fuenteDeIconos())).toBe(true);
  });

  it("(c) ningún control con ícono queda sin texto visible ni aria-label", () => {
    const problemas = rutas.flatMap((r) => controlesConIconoSinNombre(readFileSync(r, "utf8")).map((m) => `${nombreDe(r)}:${m}`));
    expect(problemas, "agregar el texto del control o un aria-label").toEqual([]);
  });

  it("(d) cada módulo del menú tiene su ícono, y no sobra ninguno", () => {
    expect(clavesDeIconos(fuenteDeIconos()).sort()).toEqual(GRUPOS_NAV.map((g) => g.id).sort());
  });

  describe("los detectores (con fuentes sintéticas)", () => {
    it("(a) marca los imports de lucide-react (estático, dinámico y require) y no otros", () => {
      expect(importaLucide('import { Pencil } from "lucide-react";')).toBe(true);
      expect(importaLucide('import { Pencil } from "lucide-react/dist/esm/icons/pencil";')).toBe(true);
      expect(importaLucide('const m = await import("lucide-react");')).toBe(true);
      expect(importaLucide('const m = require("lucide-react");')).toBe(true);
      expect(importaLucide('import { x } from "@/components/iconos";')).toBe(false);
      expect(importaLucide('// import { Pencil } from "lucide-react";')).toBe(false);
    });

    it("(b) distingue un envoltorio que oculta de uno que no", () => {
      expect(envoltorioOculta('function Icono({ icono: C }) { return <C aria-hidden="true" />; }')).toBe(true);
      expect(envoltorioOculta("function Icono({ icono: C }) { return <C aria-hidden={true} />; }")).toBe(true);
      expect(envoltorioOculta('function Icono({ icono: C }) { return <C className="x" />; }')).toBe(false);
      expect(envoltorioOculta('function Icono({ icono: C }) { return <C aria-hidden="false" />; }')).toBe(false);
      expect(envoltorioOculta('function Otra() { return <C aria-hidden="true" />; }')).toBe(false);
    });

    it("(c) marca un control que es solo el ícono, y no los que tienen texto, texto dinámico o aria-label", () => {
      expect(controlesConIconoSinNombre('const a = <Link href="/x"><IconoDeModulo id="x" /></Link>;')).toEqual(["Link@1"]);
      expect(controlesConIconoSinNombre('const a = <button type="button"><IconoAyuda /></button>;')).toEqual(["button@1"]);
      expect(controlesConIconoSinNombre('const a = <Link href="/x"><IconoDeAccion id="editar" /></Link>;')).toEqual(["Link@1"]);
      expect(controlesConIconoSinNombre('const a = <Link href="/x"><IconoDeAccion id="editar" />Editar</Link>;')).toEqual([]);
      expect(controlesConIconoSinNombre('const a = <a href="/x"><Icono icono={X} />{abierto && <IconoAyuda />}</a>;')).toEqual(["a@1"]);
      expect(controlesConIconoSinNombre('const a = <Link href="/x"><IconoDeModulo id="x" />Inicio</Link>;')).toEqual([]);
      expect(controlesConIconoSinNombre('const a = <button><span><IconoDeModulo id="x" />{grupo.label}</span></button>;')).toEqual([]);
      expect(controlesConIconoSinNombre('const a = <button aria-label="Cerrar"><IconoAyuda /></button>;')).toEqual([]);
      expect(controlesConIconoSinNombre('const a = <button><IconoAyuda /><span className="sr-only">Ayuda</span></button>;')).toEqual([]);
      expect(controlesConIconoSinNombre("const a = <div><IconoAyuda /></div>;")).toEqual([]);
      expect(controlesConIconoSinNombre("const a = <details><summary><IconoDeAccion id=\"editar\" /></summary></details>;")).toEqual(["summary@1"]);
      expect(controlesConIconoSinNombre("const a = <details><summary><IconoDeAccion id=\"editar\" />Editar</summary></details>;")).toEqual([]);
    });

    it("(d) lee las claves del mapa", () => {
      expect(clavesDeIconos('const ICONO_DE_MODULO = { administracion: A, "pos": B };')).toEqual(["administracion", "pos"]);
      expect(clavesDeIconos("const OTRO = { x: A };")).toEqual([]);
    });
  });
});
