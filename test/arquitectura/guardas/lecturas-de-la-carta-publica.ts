import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Análisis por AST (sin base) de lo que el código ALCANZABLE desde la carta pública lee de la base: qué archivos tocan un modelo de Prisma, con qué operación y qué campos piden
 * en su `select` (siguiendo las relaciones por el esquema). Lo usa `carta-publica-lista-cerrada.test.ts` (GT-13). Solo mira código: no hace falta Postgres.
 */
export const RAIZ = join(__dirname, "../../..");
const SRC = join(RAIZ, "src");

/** Operaciones de LECTURA de fila. Todo lo que no sea una de estas (escribir, contar, agrupar, agregar) es un problema declarado. */
const LECTURAS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow"]);
const OTRAS_OPERACIONES = new Set(["count", "aggregate", "groupBy", "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

// ---------------------------------------------------------------------------------------------------------------------
// El esquema: modelos, y a qué modelo apunta cada relación.
// ---------------------------------------------------------------------------------------------------------------------

const esquema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
const cuerposDeModelos = [...esquema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
/** Modelo → (campo de relación → modelo al que apunta). */
const MODELOS = new Map<string, Map<string, string>>(cuerposDeModelos.map(([, nombre]) => [nombre, new Map<string, string>()]));
for (const [, nombre, cuerpo] of cuerposDeModelos) {
  const campos = MODELOS.get(nombre)!;
  for (const linea of cuerpo.split("\n")) {
    const m = /^\s+(\w+)\s+(\w+)(\[\])?(\?)?(\s|$)/.exec(linea);
    if (m && MODELOS.has(m[2])) campos.set(m[1], m[2]);
  }
}
const minusculaInicial = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const DELEGADOS = new Map([...MODELOS.keys()].map((m) => [minusculaInicial(m), m]));

// ---------------------------------------------------------------------------------------------------------------------
// Archivos y su grafo de importaciones (solo las de valor: un `import type` no ejecuta nada).
// ---------------------------------------------------------------------------------------------------------------------

const cache = new Map<string, ts.SourceFile>();
function leer(ruta: string): ts.SourceFile {
  let sf = cache.get(ruta);
  if (!sf) {
    sf = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    cache.set(ruta, sf);
  }
  return sf;
}

export const relativa = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

function resolverModulo(desde: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? join(dirname(desde), especificador) : null;
  if (!base) return null;
  for (const candidato of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(candidato)) return candidato;
  return null;
}

/** Los archivos de `src` que `desde` importa por valor (imports, reexports y `import()` dinámicos). */
function importacionesDeValor(ruta: string): string[] {
  const sf = leer(ruta);
  const salida: string[] = [];
  const agregar = (especificador: string) => {
    const r = resolverModulo(ruta, especificador);
    if (r) salida.push(r);
  };
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const soloTipos = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!soloTipos) agregar(n.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && !n.isTypeOnly) agregar(n.moduleSpecifier.text);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) agregar(n.arguments[0].text);
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return salida;
}

/** Todo lo que se alcanza desde `entradas` (rutas absolutas), siguiendo importaciones de valor. Incluye las entradas. */
export function alcanzables(entradas: readonly string[]): string[] {
  const vistos = new Set(entradas);
  const pendientes = [...entradas];
  while (pendientes.length) {
    for (const d of importacionesDeValor(pendientes.pop()!)) {
      if (vistos.has(d)) continue;
      vistos.add(d);
      pendientes.push(d);
    }
  }
  return [...vistos].sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// Qué lee cada archivo de la base.
// ---------------------------------------------------------------------------------------------------------------------

export interface Acceso {
  archivo: string;
  modelo: string;
  operacion: string;
  linea: number;
  /** `Modelo.campo` por cada clave del `select` (las relaciones también: `Producto.categoria`), recursivo. */
  campos: string[];
  problemas: string[];
}

/** Resuelve una expresión a un objeto literal: lo escrito ahí, una constante del mismo archivo o de uno importado, o el `return` de una función. `null` si no se puede. */
function aObjeto(expr: ts.Expression, ruta: string, profundidad = 0): { nodo: ts.ObjectLiteralExpression; ruta: string } | null {
  if (profundidad > 6) return null;
  if (ts.isObjectLiteralExpression(expr)) return { nodo: expr, ruta };
  if (ts.isAsExpression(expr) || ts.isParenthesizedExpression(expr) || ts.isSatisfiesExpression(expr)) return aObjeto(expr.expression, ruta, profundidad + 1);
  if (ts.isIdentifier(expr)) {
    const def = buscarDefinicion(expr.text, ruta);
    if (def?.tipo === "const") return aObjeto(def.valor, def.ruta, profundidad + 1);
    return null;
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const def = buscarDefinicion(expr.expression.text, ruta);
    if (def?.tipo === "funcion") return aObjeto(def.valor, def.ruta, profundidad + 1);
  }
  return null;
}

type Definicion = { tipo: "const" | "funcion"; valor: ts.Expression; ruta: string };

/** La definición de un nombre en el archivo o, si está importado, en el archivo de origen. Una función se resuelve por su `return` (el último de nivel superior). */
function buscarDefinicion(nombre: string, ruta: string, profundidad = 0): Definicion | null {
  if (profundidad > 4) return null;
  const sf = leer(ruta);
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === nombre && d.initializer) {
          if (ts.isArrowFunction(d.initializer)) return { tipo: "funcion", valor: d.initializer.body as ts.Expression, ruta };
          return { tipo: "const", valor: d.initializer, ruta };
        }
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name?.text === nombre && st.body) {
      const ret = [...st.body.statements].reverse().find(ts.isReturnStatement);
      if (ret?.expression) return { tipo: "funcion", valor: ret.expression, ruta };
    }
    // Una fachada que reexporta (`export { x } from "./y"`): se sigue hasta el archivo que lo define.
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      const el = st.exportClause.elements.find((e) => e.name.text === nombre);
      const destino = el && resolverModulo(ruta, st.moduleSpecifier.text);
      if (el && destino) return buscarDefinicion((el.propertyName ?? el.name).text, destino, profundidad + 1);
    }
    if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings) && ts.isStringLiteral(st.moduleSpecifier)) {
      const el = st.importClause.namedBindings.elements.find((e) => e.name.text === nombre);
      const destino = el && resolverModulo(ruta, st.moduleSpecifier.text);
      if (el && destino) return buscarDefinicion((el.propertyName ?? el.name).text, destino, profundidad + 1);
    }
  }
  return null;
}

const clave = (p: ts.ObjectLiteralElementLike): string | null => ("name" in p && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

function camposDeSelect(modelo: string, objeto: { nodo: ts.ObjectLiteralExpression; ruta: string }, problemas: string[], acumulado: string[]): void {
  for (const p of objeto.nodo.properties) {
    const nombre = clave(p);
    if (!nombre) {
      problemas.push(`un select con un elemento que no es una clave (¿spread?) en ${modelo}`);
      continue;
    }
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) {
      problemas.push(`${modelo}.${nombre}: forma de select no soportada`);
      continue;
    }
    const valor = ts.isPropertyAssignment(p) ? p.initializer : undefined;
    if (valor?.kind === ts.SyntaxKind.FalseKeyword) continue;
    if (valor?.kind === ts.SyntaxKind.TrueKeyword) {
      acumulado.push(`${modelo}.${nombre}`);
      continue;
    }
    const destino = MODELOS.get(modelo)?.get(nombre);
    const anidado = valor && aObjeto(valor, objeto.ruta);
    if (!destino || !anidado) {
      problemas.push(`${modelo}.${nombre}: no es una relación del esquema con un select resoluble (¿_count, una expresión?)`);
      continue;
    }
    acumulado.push(`${modelo}.${nombre}`);
    const subselect = anidado.nodo.properties.find((q): q is ts.PropertyAssignment => ts.isPropertyAssignment(q) && clave(q) === "select");
    const resuelto = subselect && aObjeto(subselect.initializer, anidado.ruta);
    if (!resuelto) problemas.push(`${modelo}.${nombre}: relación sin select (trae la fila entera de ${destino})`);
    else camposDeSelect(destino, resuelto, problemas, acumulado);
  }
}

/** Todo acceso a un modelo de Prisma (`<x>.<modelo>.<operación>(…)`) de los archivos dados. */
export function accesosA(archivos: readonly string[]): Acceso[] {
  const salida: Acceso[] = [];
  for (const ruta of archivos) {
    const sf = leer(ruta);
    const visitar = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression)) {
        const operacion = n.expression.name.text;
        const modelo = DELEGADOS.get(n.expression.expression.name.text);
        if (modelo && (LECTURAS.has(operacion) || OTRAS_OPERACIONES.has(operacion))) {
          const problemas: string[] = [];
          const campos: string[] = [];
          if (!LECTURAS.has(operacion)) problemas.push(`la operación ${operacion} no es una lectura de fila`);
          const arg = n.arguments[0] && aObjeto(n.arguments[0], ruta);
          if (LECTURAS.has(operacion)) {
            if (!arg) problemas.push("los argumentos no son un objeto resoluble");
            else {
              for (const p of arg.nodo.properties) if (clave(p) === "include") problemas.push("usa include (trae la fila entera de la relación)");
              const sel = arg.nodo.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && clave(p) === "select");
              const resuelto = sel && aObjeto(sel.initializer, ruta);
              if (!resuelto) problemas.push("sin select (trae la fila entera)");
              else camposDeSelect(modelo, resuelto, problemas, campos);
            }
          }
          salida.push({ archivo: relativa(ruta), modelo, operacion, linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, campos, problemas });
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
  }
  return salida;
}

/** Los accesos de un texto sintético (para probar el propio analizador): se lo trata como un archivo de `src/server/lecturas`, así que sus importaciones resuelven contra el árbol real. */
export function accesosDeTexto(texto: string): Acceso[] {
  const ruta = join(SRC, "server/lecturas/_sintetico.ts");
  cache.set(ruta, ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  try {
    return accesosA([ruta]);
  } finally {
    cache.delete(ruta);
  }
}

/** Líneas de los archivos dados que llaman SQL crudo de lectura (`$queryRaw`, `$queryRawUnsafe`): se saltea toda la disciplina del `select`. */
export function consultasCrudas(archivos: readonly string[]): string[] {
  const salida: string[] = [];
  for (const ruta of archivos) {
    const sf = leer(ruta);
    const visitar = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && (n.text === "$queryRaw" || n.text === "$queryRawUnsafe")) salida.push(`${relativa(ruta)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
  }
  return salida;
}
