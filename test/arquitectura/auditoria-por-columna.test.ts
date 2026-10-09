import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ENTIDADES_AUDITABLES } from "../../src/core/permisos/auditoria";

/**
 * GT-5 del plan de endurecimiento de seguridad (nace en la tanda T2; S-05 y S-06): AUDITORÍA POR COLUMNA.
 *
 * `escrituras-auditadas.test.ts` exige que toda función que escribe dinero o cambia el significado de una cantidad llame a `registrarCambioAuditado`, pero mira la FUNCIÓN
 * entera: si una edición audita tres columnas y alguien saca la cuarta, sigue en verde (así quedó el factor de conversión de un producto sin rastro mientras se auditaban
 * los precios). Este guardián fija, para los dos casos de uso que ya auditan por columna, la LISTA CERRADA de columnas que dejan su fila, en las dos direcciones:
 *  1. toda columna de la lista aparece como `campo: "<columna>"` de un cambio auditado en el archivo (sacar una → rojo);
 *  2. todo `campo: "<literal>"` auditado del archivo está en la lista (una columna nueva se declara acá, con su entidad);
 *  3. la entidad es una de `ENTIDADES_AUDITABLES` (si no, la pantalla de auditoría no la filtra).
 * Pendientes declarados (S-56): el alta de producto, el portal y la disponibilidad no auditan por columna todavía.
 * CONSOLIDADO (T14, M-3 de la auditoría intermedia): además del literal, se exige que la auditoría SE EJECUTE (`problemasDeEjecucion`, abajo), y `escrituras-auditadas` suma las seis columnas
 * de significado de `producto` a `COLUMNAS_DE_SIGNIFICADO` (el plan lo pedía y T2 solo había sumado `promoCartaCupo`).
 */
const RAIZ = join(__dirname, "../..");

const COLUMNAS_AUDITADAS: { archivo: string; entidad: (typeof ENTIDADES_AUDITABLES)[number]; campos: string[] }[] = [
  {
    archivo: "src/server/actions/catalogo/casos-de-uso/actualizar-producto.ts",
    entidad: "Producto",
    campos: ["precioVenta", "precioConsignacion", "pasoVenta", "factorConversion", "unidadStockId", "unidadCompraId", "seProduce", "esConsignacion", "proveedorConsignacionId"],
  },
  {
    archivo: "src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta.ts",
    entidad: "PromoCartaCupo",
    campos: ["cantidadMinima", "cantidadMaxima"],
  },
];

/** Los literales de texto de `campo: "<literal>"` y de `entidad: "<literal>"` que hay en el código (propiedades de un literal de objeto). */
export function camposYEntidadesAuditados(codigo: string): { campos: string[]; entidades: string[] } {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const campos: string[] = [];
  const entidades: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && ts.isStringLiteralLike(n.initializer)) {
      if (n.name.text === "campo") campos.push(n.initializer.text);
      if (n.name.text === "entidad") entidades.push(n.initializer.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { campos, entidades };
}

/**
 * Que la auditoría de cada columna SE EJECUTE, no solo que su literal exista (M-3 de la auditoría intermedia: borrar la llamada a `auditarSignificadoDeProducto`, o el `for` que llama a
 * `registrarCambioAuditado`, dejaba el literal `campo: "factorConversion"` en el archivo y todo en verde). Por AST, para cada `campo: "<literal>"`:
 *  1. la función que lo contiene (o, a nivel de módulo, ninguna: falla cerrado) llama a `registrarCambioAuditado`. Si el literal es el de la propia llamada (`registrarCambioAuditado(tx, { campo: "x" })`)
 *     alcanza; si está en una tabla de cambios (`const cambios = [{ campo: "x", … }]`), la llamada de esa función tiene que llevar un `campo:` NO literal (`campo: c.campo`): el `for` que la recorre.
 *  2. esa función es ALCANZABLE desde una función exportada del archivo (la del caso de uso), siguiendo los nombres de funciones del mismo archivo que cada cuerpo menciona.
 * Un `if (false)`/`&& false` o un condicional que nunca se cumple no se ven: es una búsqueda estática; lo que sí ve es sacar la llamada, el bucle o el ayudante.
 */
export function problemasDeEjecucion(codigo: string, campos: readonly string[]): string[] {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const esFuncion = (n: ts.Node): n is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);
  /** Funciones de primer nivel por nombre. */
  const nombradas = new Map<string, ts.Node>();
  const exportadas = new Set<string>();
  for (const s of fuente.statements) {
    const exportada = ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(s) && s.name && s.body) {
      nombradas.set(s.name.text, s.body);
      if (exportada) exportadas.add(s.name.text);
    }
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          nombradas.set(d.name.text, d.initializer.body);
          if (exportada) exportadas.add(d.name.text);
        }
      }
    }
  }
  const nombreDeLaLlamada = (n: ts.Node) => (ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : undefined);
  /** Las llamadas a `registrarCambioAuditado` dentro de un nodo (sin entrar en funciones anidadas con nombre propio de primer nivel: son otras). */
  const auditorasEn = (nodo: ts.Node): ts.CallExpression[] => {
    const salida: ts.CallExpression[] = [];
    const visitar = (n: ts.Node): void => {
      if (nombreDeLaLlamada(n) === "registrarCambioAuditado") salida.push(n as ts.CallExpression);
      ts.forEachChild(n, visitar);
    };
    visitar(nodo);
    return salida;
  };
  const mencionados = (cuerpo: ts.Node): Set<string> => {
    const ids = new Set<string>();
    const visitar = (n: ts.Node): void => {
      // una LLAMADA (`ayudante(…)`), no cualquier mención: `void ayudante;` o pasarlo sin llamarlo no lo ejecuta
      const llamado = nombreDeLaLlamada(n);
      if (llamado !== undefined && nombradas.has(llamado)) ids.add(llamado);
      ts.forEachChild(n, visitar);
    };
    visitar(cuerpo);
    return ids;
  };
  // Alcanzables desde las exportadas.
  const alcanzables = new Set<string>(exportadas);
  for (const pila = [...exportadas]; pila.length; ) {
    const actual = pila.pop()!;
    for (const m of mencionados(nombradas.get(actual)!)) {
      if (!alcanzables.has(m)) {
        alcanzables.add(m);
        pila.push(m);
      }
    }
  }
  /** La función de primer nivel que contiene al nodo, o `undefined` si está a nivel de módulo. */
  const funcionDeNivelSuperior = (n: ts.Node): string | undefined => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (esFuncion(p)) {
        const dueno = ts.isFunctionDeclaration(p) ? p.name?.text : ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name) ? p.parent.name.text : undefined;
        if (dueno && nombradas.has(dueno) && fuente.statements.includes(ts.isFunctionDeclaration(p) ? p : (p.parent.parent.parent as ts.Statement))) return dueno;
      }
    }
    return undefined;
  };
  const problemas: string[] = [];
  for (const campo of campos) {
    const literales: ts.PropertyAssignment[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "campo" && ts.isStringLiteralLike(n.initializer) && n.initializer.text === campo) literales.push(n);
      ts.forEachChild(n, visitar);
    };
    visitar(fuente);
    if (!literales.length) {
      problemas.push(`${campo}: no hay ningún \`campo: "${campo}"\``);
      continue;
    }
    // Alcanza con UNA aparición que se ejecute de verdad.
    const razones = literales.map((lit): string | undefined => {
      const funcion = funcionDeNivelSuperior(lit);
      if (!funcion) return `a nivel de módulo (no se puede seguir quién la ejecuta)`;
      if (!alcanzables.has(funcion)) return `en «${funcion}», que ninguna función exportada del archivo llama`;
      const llamadas = auditorasEn(nombradas.get(funcion)!);
      if (!llamadas.length) return `en «${funcion}», que no llama a registrarCambioAuditado`;
      const directa = llamadas.some((c) => c.arguments.some((a) => a === lit.parent || (lit.parent.parent && lit.parent.parent === a) || a.getFullStart() <= lit.getFullStart() && lit.getEnd() <= a.getEnd()));
      if (directa) return undefined;
      const dinamica = llamadas.some((c) =>
        c.arguments.some(
          (a) =>
            ts.isObjectLiteralExpression(a) &&
            a.properties.some(
              (p) =>
                // `campo: c.campo` o la forma abreviada `campo` (la variable del bucle se llama así)
                (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "campo" && !ts.isStringLiteralLike(p.initializer)) || (ts.isShorthandPropertyAssignment(p) && p.name.text === "campo"),
            ),
        ),
      );
      return dinamica ? undefined : `en la tabla de «${funcion}», cuya llamada a registrarCambioAuditado no recorre la tabla (le falta \`campo: <variable del bucle>\`)`;
    });
    if (razones.every((r) => r !== undefined)) problemas.push(`${campo}: el literal está pero la auditoría no se ejecuta — ${razones[0]}`);
  }
  return problemas;
}

describe("GT-5: la auditoría de cada columna se ejecuta, no solo existe su literal (M-3 de la auditoría intermedia)", () => {
  it.each(COLUMNAS_AUDITADAS)("$archivo: cada columna se audita por una función alcanzable desde la exportada, que llama a registrarCambioAuditado", ({ archivo, campos }) => {
    expect(problemasDeEjecucion(readFileSync(join(RAIZ, archivo), "utf8"), campos)).toEqual([]);
  });

  describe("el analizador (casos sintéticos, con las dos formas del código real)", () => {
    const DIRECTA = 'export async function caso(tx) { await registrarCambioAuditado(tx, { entidad: "P", campo: "a" }); }';
    const TABLA = [
      "export async function caso(tx) { await auditar(tx); }",
      "async function auditar(tx) {",
      '  const cambios = [{ campo: "a", x: 1 }, { campo: "b", x: 2 }];',
      '  for (const c of cambios) { await registrarCambioAuditado(tx, { entidad: "P", campo: c.campo }); }',
      "}",
    ].join("\n");

    it("la llamada directa y la tabla recorrida por un bucle pasan", () => {
      expect(problemasDeEjecucion(DIRECTA, ["a"])).toEqual([]);
      expect(problemasDeEjecucion(TABLA, ["a", "b"])).toEqual([]);
    });

    it("sacar la llamada al ayudante que audita (la mutación de `auditarSignificadoDeProducto`): el literal queda pero no se ejecuta", () => {
      const sinLlamada = TABLA.replace("{ await auditar(tx); }", "{ }");
      expect(problemasDeEjecucion(sinLlamada, ["a"])[0]).toContain("que ninguna función exportada del archivo llama");
    });

    it("sacar el bucle que llama a registrarCambioAuditado (los literales quedan en la tabla)", () => {
      const sinBucle = TABLA.replace(/\n {2}for .*\n/, "\n");
      expect(problemasDeEjecucion(sinBucle, ["a"])[0]).toContain("no llama a registrarCambioAuditado");
    });

    it("un bucle cuya llamada no usa la variable (campo fijo en otra columna) no cubre la tabla", () => {
      const fijo = TABLA.replace("campo: c.campo", 'campo: "a"');
      expect(problemasDeEjecucion(fijo, ["b"])[0]).toContain("no recorre la tabla");
    });

    it("la forma abreviada `{ campo }` (el bucle desestructura `campo`) también recorre la tabla", () => {
      const abreviada = TABLA.replace("for (const c of cambios)", "for (const { campo } of cambios)").replace("campo: c.campo", "campo");
      expect(problemasDeEjecucion(abreviada, ["a", "b"])).toEqual([]);
    });

    it("la llamada directa borrada, o la función que audita sin que nadie la llame, falla; un literal a nivel de módulo falla cerrado", () => {
      expect(problemasDeEjecucion(DIRECTA.replace("await registrarCambioAuditado(tx, { entidad: \"P\", campo: \"a\" });", ""), ["a"])[0]).toContain("no hay ningún");
      expect(problemasDeEjecucion('async function huerfana(tx) { await registrarCambioAuditado(tx, { campo: "a" }); }\nexport async function caso() {}', ["a"])[0]).toContain("que ninguna función exportada");
      expect(problemasDeEjecucion('const t = [{ campo: "a" }];\nexport async function caso(tx) { await registrarCambioAuditado(tx, { campo: "z" }); }', ["a"])[0]).toContain("a nivel de módulo");
    });
  });
});

describe("GT-5: auditoría por columna (lista cerrada)", () => {
  it.each(COLUMNAS_AUDITADAS)("$archivo audita exactamente sus columnas, en las dos direcciones", ({ archivo, entidad, campos }) => {
    const { campos: auditados, entidades } = camposYEntidadesAuditados(readFileSync(join(RAIZ, archivo), "utf8"));
    expect(auditados.sort(), `${archivo}: las columnas auditadas no coinciden con la lista cerrada (una que falta es un campo sin rastro; una que sobra, una columna nueva sin declarar acá)`).toEqual([...campos].sort());
    expect(new Set(entidades), `${archivo}: la entidad auditada`).toEqual(new Set([entidad]));
    expect(ENTIDADES_AUDITABLES as readonly string[]).toContain(entidad);
  });

  it("el analizador ve una columna que se saca y una que se suma (control de sanidad)", () => {
    const base = 'async function f(tx) { await registrarCambioAuditado(tx, { entidad: "Producto", campo: "a" }); await registrarCambioAuditado(tx, { entidad: "Producto", campo: "b" }); }';
    expect(camposYEntidadesAuditados(base).campos).toEqual(["a", "b"]);
    expect(camposYEntidadesAuditados(base.replace('campo: "b"', "campo: variable")).campos).toEqual(["a"]);
    expect(camposYEntidadesAuditados(base.replace('campo: "b"', 'campo: "b" }); await registrarCambioAuditado(tx, { campo: "c"')).campos).toEqual(["a", "b", "c"]);
  });
});
