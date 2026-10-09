import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { funcionDeInicializador } from "./analizador";

/**
 * Herramientas de GT-1 (campos sensibles → piso mínimo) para ver QUIÉN LEE un campo de la base y A QUÉ PÁGINAS LLEGA (tanda T14 del plan de endurecimiento de seguridad).
 *
 * Tres piezas, todas por AST y sin base:
 *  1. `modelosDelSchema`: modelo → campo → { tipo, lista, esModelo }, leído de `prisma/schema.prisma` (no se mantiene a mano; recibe el texto, así que se prueba con LF y con CRLF).
 *  2. `lectoresEnFuente`: dónde un archivo PIDE un campo sensible a Prisma, sabiendo de QUÉ MODELO es (un `email` de `Proveedor` no es el `email` de `User`): el `select`/`include` de una
 *     llamada `x.<modelo>.<op>(…)`, anidado por las relaciones del schema (`select: { creadoPor: { select: { email: true } } }` es `User.email`); los agregados (`_sum`, `_min`, …) y `by`
 *     del `groupBy`; el SQL crudo (`$queryRaw…`) que nombra la tabla y la columna. Una constante `const SELECT_X = { … }` que el `select` toma por nombre se sigue (en el mismo archivo).
 *  3. `grafoDeImports` y `paginasQueAlcanzan`: el grafo de imports de valor (los `import type` no son una dependencia de datos) y, desde un lector, las páginas (`page.tsx`/`route.ts`)
 *     que lo importan directo o a través de la MISMA capa de acceso a datos (`server/consultas`, `server/lecturas`, Server Actions que no son casos de uso, y los componentes y archivos
 *     de `app` que no son página). No se sigue a `core/` ni a los barriles: un recorrido transitivo total alcanza a las 84 páginas por cualquier barril y no dice nada.
 */

export interface CampoDeModelo {
  tipo: string;
  lista: boolean;
  esModelo: boolean;
}

/** Modelo → campo → forma. Los nombres de relación (campos cuyo tipo es otro modelo) llevan `esModelo`. */
export function modelosDelSchema(schema: string): Map<string, Map<string, CampoDeModelo>> {
  const texto = schema.replace(/\r\n/g, "\n");
  const cuerpos = [...texto.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const nombres = new Set(cuerpos.map((m) => m[1]!));
  const salida = new Map<string, Map<string, CampoDeModelo>>();
  for (const [, nombre, cuerpo] of cuerpos) {
    const campos = new Map<string, CampoDeModelo>();
    for (const linea of cuerpo!.split("\n")) {
      const m = /^\s+(\w+)\s+(\w+)(\[\])?\??(?:\s|$)/.exec(linea);
      if (m && !linea.trim().startsWith("//") && !linea.trim().startsWith("@@")) campos.set(m[1]!, { tipo: m[2]!, lista: m[3] !== undefined, esModelo: nombres.has(m[2]!) });
    }
    salida.set(nombre!, campos);
  }
  return salida;
}

export interface Lector {
  /** `Modelo.campo`. */
  campo: string;
  /** Cómo se pide: `select` (incluye `include` anidado), `agregado` (`_sum`/`by`/…) o `sql` (SQL crudo). */
  via: "select" | "agregado" | "sql";
  /** La función (o `(módulo)`) que lo pide. */
  funcion: string;
}

const OPERACIONES = new Set([
  "findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "aggregate", "groupBy", "create", "createManyAndReturn", "update", "upsert", "delete",
]);
const AGREGADOS = new Set(["_sum", "_avg", "_min", "_max", "_count"]);

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function sinEnvoltorios(e: ts.Expression): ts.Expression {
  return ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) ? sinEnvoltorios(e.expression) : e;
}

function funcionQueContiene(nodo: ts.Node): string {
  let nombre = "(módulo)";
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    // I-2 de la auditoría final: también `export const x = conRegistro(async () => …)` / `(async () => …) as T`: la función con nombre es la constante, no «(módulo)».
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && funcionDeInicializador(p.initializer)) nombre = p.name.text;
  }
  return nombre;
}

const nombreDe = (p: ts.ObjectLiteralElementLike): string | undefined => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : undefined);

/**
 * Los campos sensibles de `sensibles` (modelo → conjunto de campos) que el archivo pide a Prisma. `via` distingue cómo. Un campo pedido dos veces en la misma función se informa una vez.
 */
export function lectoresEnFuente(codigo: string, ruta: string, modelos: ReadonlyMap<string, ReadonlyMap<string, CampoDeModelo>>, sensibles: ReadonlyMap<string, ReadonlySet<string>>): Lector[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const delegados = new Map([...modelos.keys()].map((m) => [minuscula(m), m]));
  const salida = new Map<string, Lector>();
  const anotar = (campo: string, via: Lector["via"], nodo: ts.Node) => {
    const funcion = funcionQueContiene(nodo);
    salida.set(`${campo}|${via}|${funcion}`, { campo, via, funcion });
  };

  // Constantes de primer nivel (`const SELECT_X = { … }`), para seguir un `select: SELECT_X`.
  const constantes = new Map<string, ts.Expression>();
  for (const s of fuente.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) constantes.set(d.name.text, d.initializer);
  }
  const resolver = (e: ts.Expression): ts.Expression => {
    const limpio = sinEnvoltorios(e);
    if (ts.isIdentifier(limpio) && constantes.has(limpio.text)) return sinEnvoltorios(constantes.get(limpio.text)!);
    return limpio;
  };

  const visitarSeleccion = (valor: ts.Expression, modelo: string, profundidad: number): void => {
    if (profundidad > 8) return;
    const objeto = resolver(valor);
    if (!ts.isObjectLiteralExpression(objeto)) return;
    const campos = modelos.get(modelo);
    for (const p of objeto.properties) {
      const nombre = nombreDe(p);
      if (!nombre || !campos) continue;
      const campo = campos.get(nombre);
      if (!campo) continue;
      if (campo.esModelo) {
        // Una RELACIÓN también puede ser el dato sensible (`Operacion.proveedor`: quién le vendió): pedirla, con `true` o con su propio `select`, es leerla.
        const relacionPedida = ts.isShorthandPropertyAssignment(p) || (ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.FalseKeyword);
        if (relacionPedida && sensibles.get(modelo)?.has(nombre)) anotar(`${modelo}.${nombre}`, "select", p);
        if (ts.isPropertyAssignment(p)) {
          const interno = resolver(p.initializer);
          if (ts.isObjectLiteralExpression(interno)) {
            for (const q of interno.properties) {
              if (ts.isPropertyAssignment(q) && (nombreDe(q) === "select" || nombreDe(q) === "include")) visitarSeleccion(q.initializer, campo.tipo, profundidad + 1);
            }
          }
        }
        continue;
      }
      const pedido = ts.isShorthandPropertyAssignment(p) || (ts.isPropertyAssignment(p) && p.initializer.kind !== ts.SyntaxKind.FalseKeyword);
      if (pedido && sensibles.get(modelo)?.has(nombre)) anotar(`${modelo}.${nombre}`, "select", p);
    }
  };

  const textoSql = (n: ts.Node): string | undefined => {
    if (ts.isTaggedTemplateExpression(n) && /(queryRaw|executeRaw)/.test(n.tag.getText(fuente))) return ts.isNoSubstitutionTemplateLiteral(n.template) ? n.template.text : [n.template.head.text, ...n.template.templateSpans.map((s) => s.literal.text)].join(" ");
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^\$(queryRaw|executeRaw)/.test(n.expression.name.text)) {
      const a = n.arguments[0];
      if (a && (ts.isStringLiteralLike(a) || ts.isTemplateExpression(a))) return a.getText(fuente);
    }
    return undefined;
  };

  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && OPERACIONES.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const modelo = delegados.get(n.expression.expression.name.text);
      const args = n.arguments[0];
      if (modelo && args && ts.isObjectLiteralExpression(args)) {
        for (const p of args.properties) {
          const clave = nombreDe(p);
          if (!clave || !ts.isPropertyAssignment(p)) continue;
          if (clave === "select" || clave === "include") visitarSeleccion(p.initializer, modelo, 0);
          if (AGREGADOS.has(clave)) {
            const o = resolver(p.initializer);
            if (ts.isObjectLiteralExpression(o)) for (const q of o.properties) if (nombreDe(q) && sensibles.get(modelo)?.has(nombreDe(q)!)) anotar(`${modelo}.${nombreDe(q)}`, "agregado", q);
          }
          if (clave === "by") {
            const a = resolver(p.initializer);
            if (ts.isArrayLiteralExpression(a)) for (const e of a.elements) if (ts.isStringLiteralLike(e) && sensibles.get(modelo)?.has(e.text)) anotar(`${modelo}.${e.text}`, "agregado", e);
          }
        }
      }
    }
    const sql = textoSql(n);
    if (sql !== undefined) {
      // Solo lo que el SQL DEVUELVE: la lista de columnas de cada `SELECT … FROM` y de un `RETURNING`. Un `WHERE o."proveedorId" IS NOT NULL` filtra, no entrega el dato. Un `*` devuelve todo:
      // falla cerrado (cuenta todos los campos sensibles de las tablas que el SQL nombra).
      const devueltas = [...sql.matchAll(/\bSELECT\b([\s\S]*?)\bFROM\b/gi), ...sql.matchAll(/\bRETURNING\b([\s\S]*?)(?:;|`|$)/gi)].map((m) => m[1]!).join(" , ");
      const todo = /(^|[\s,.])\*/.test(devueltas);
      for (const [modelo, campos] of sensibles) {
        if (!sql.includes(`"${modelo}"`)) continue;
        for (const campo of campos) if (todo || new RegExp(`\\b${campo}\\b`).test(devueltas)) anotar(`${modelo}.${campo}`, "sql", n);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return [...salida.values()];
}

/** Los nombres que el archivo exporta como función o constante (`export function f`, `export const f = …`, `export { f }`). */
function nombresExportados(codigo: string, ruta = "x.ts"): Set<string> {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const salida = new Set<string>();
  const exportado = (s: ts.Node) => ts.canHaveModifiers(s) && ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of fuente.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && exportado(s)) salida.add(s.name.text);
    if (ts.isVariableStatement(s) && exportado(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) salida.add(d.name.text);
    if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause) && !s.moduleSpecifier) for (const e of s.exportClause.elements) salida.add(e.name.text);
  }
  return salida;
}

/**
 * Las funciones EXPORTADAS del archivo desde las que se llega, dentro del mismo archivo, a alguna de las funciones `lectoras` (ellas incluidas), o `null` si no se puede decir (un lector
 * suelto en el módulo, o uno que no es una función de primer nivel): entonces se toma el archivo entero.
 */
export function exportadasQueAlcanzan(codigo: string, lectoras: readonly string[], ruta = "x.ts"): string[] | null {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const cuerpos = new Map<string, ts.Node>();
  for (const s of fuente.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) cuerpos.set(s.name.text, s.body);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        const funcion = ts.isIdentifier(d.name) && d.initializer ? funcionDeInicializador(d.initializer) : undefined;
        if (funcion && ts.isIdentifier(d.name)) cuerpos.set(d.name.text, funcion.body);
      }
    }
  }
  if (lectoras.some((l) => !cuerpos.has(l))) return null;
  const llamadas = new Map<string, Set<string>>();
  for (const [nombre, cuerpo] of cuerpos) {
    const usados = new Set<string>();
    const visitar = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && cuerpos.has(n.text)) usados.add(n.text);
      ts.forEachChild(n, visitar);
    };
    visitar(cuerpo);
    llamadas.set(nombre, usados);
  }
  const alcanzan = new Set(lectoras);
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const [nombre, usados] of llamadas) {
      if (!alcanzan.has(nombre) && [...usados].some((u) => alcanzan.has(u))) {
        alcanzan.add(nombre);
        cambio = true;
      }
    }
  }
  const exportadas = nombresExportados(codigo, ruta);
  return [...alcanzan].filter((n) => exportadas.has(n)).sort();
}

export function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivosTs(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Un import de valor: a qué archivo apunta y qué nombres trae (`null` = no se sabe cuáles: `import * as`, por defecto, re-exportación, `import()`). */
export interface Arista {
  destino: string;
  nombres: readonly string[] | null;
}

/** Archivo (relativo a la raíz del repo, con `/`) → los imports de valor que hace a otros archivos de `src/` (alias `@/` o relativo; no cuenta `import type`). */
export function grafoDeImports(raiz: string): Map<string, Arista[]> {
  const src = join(raiz, "src");
  const archivos = archivosTs(src);
  const rel = (f: string) => relative(raiz, f).split(sep).join("/");
  const existentes = new Set(archivos.map(rel));
  const resolver = (especificador: string, desde: string): string | null => {
    let base: string;
    if (especificador.startsWith("@/")) base = join(src, especificador.slice(2));
    else if (especificador.startsWith(".")) base = join(dirname(join(raiz, desde)), especificador);
    else return null;
    for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) if (existentes.has(rel(c))) return rel(c);
    return null;
  };
  const grafo = new Map<string, Arista[]>();
  for (const f of archivos) {
    const r = rel(f);
    const sf = ts.createSourceFile(r, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, r.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const destinos: Arista[] = [];
    const agregar = (especificador: string, nombres: readonly string[] | null) => {
      const t = resolver(especificador, r);
      if (t) destinos.push({ destino: t, nombres });
    };
    const visitar = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        let soloTipos = false;
        let nombres: string[] | null = null;
        if (ts.isImportDeclaration(n) && n.importClause) {
          const c = n.importClause;
          const nombrados = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : [];
          soloTipos = c.isTypeOnly || (!c.name && nombrados.length > 0 && nombrados.every((e) => e.isTypeOnly));
          // Con nombre por defecto o `import * as`, no se sabe qué función se usa: se toma el módulo entero.
          if (!c.name && c.namedBindings && ts.isNamedImports(c.namedBindings)) nombres = nombrados.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text);
        }
        if (ts.isExportDeclaration(n) && n.isTypeOnly) soloTipos = true;
        if (!soloTipos) agregar(n.moduleSpecifier.text, nombres);
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) agregar(n.arguments[0].text, null);
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    grafo.set(r, destinos);
  }
  return grafo;
}

export const esPagina = (f: string) => /\/(page|route)\.tsx?$/.test(f);

/** La capa de acceso a datos que se sigue hacia arriba: consultas, lecturas, Server Actions que no son casos de uso, y los componentes y archivos de `app` que no son página. */
const esCapaDeAccesoADatos =(f: string) =>
  /^src\/server\/(consultas|lecturas)\//.test(f) || (/^src\/server\/actions\//.test(f) && !f.includes("/casos-de-uso/")) || /^src\/(app|components)\//.test(f);

/** Un importador: quién importa y qué nombres trae (`null` = no se sabe). */
export interface Importador {
  desde: string;
  nombres: readonly string[] | null;
}

/**
 * Las páginas (`page.tsx`/`route.ts`) que importan el lector, directo o a través de la capa de acceso a datos. Si el lector es una página, es ella misma.
 * `funcionesDelLector`: las funciones EXPORTADAS que piden el campo (`null` si alguna es un ayudante interno o no se sabe). En el PRIMER salto, un importador que trae otras funciones del
 * mismo módulo no es un consumidor del dato (la ficha del proveedor y el selector de proveedores viven en el mismo archivo y no comparten campos); de ahí en adelante se toma el archivo entero.
 */
export function paginasQueAlcanzan(lector: string, importadores: ReadonlyMap<string, readonly Importador[]>, funcionesDelLector: readonly string[] | null = null): string[] {
  const vistos = new Set([lector]);
  const pila: string[] = [];
  const paginas = new Set<string>(esPagina(lector) ? [lector] : []);
  const llegar = (y: string) => {
    if (vistos.has(y)) return;
    vistos.add(y);
    if (esPagina(y)) paginas.add(y);
    else if (esCapaDeAccesoADatos(y)) pila.push(y);
  };
  for (const i of importadores.get(lector) ?? []) {
    if (funcionesDelLector !== null && i.nombres !== null && !i.nombres.some((n) => funcionesDelLector.includes(n))) continue;
    llegar(i.desde);
  }
  while (pila.length) {
    const x = pila.pop()!;
    for (const i of importadores.get(x) ?? []) llegar(i.desde);
  }
  return [...paginas].sort();
}

/** Inversa de `grafoDeImports`: archivo → quiénes lo importan. */
export function importadoresDe(grafo: ReadonlyMap<string, readonly Arista[]>): Map<string, Importador[]> {
  const inv = new Map<string, Importador[]>();
  for (const [f, destinos] of grafo) for (const d of destinos) inv.set(d.destino, [...(inv.get(d.destino) ?? []), { desde: f, nombres: d.nombres }]);
  return inv;
}
