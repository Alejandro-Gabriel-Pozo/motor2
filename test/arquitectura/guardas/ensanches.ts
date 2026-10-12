import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Lectura por AST de los ENSANCHES del alcance por sucursal (M.3-A4, `src/server/acceso/alcance.ts`): dónde se los llama, con qué argumentos y qué hay antes en la misma función. Lo usan
 * los dos guardianes de GT-4 (`ids-de-sucursal-declaran-a-que-se-atan.test.ts`, `escrituras-en-sucursal-desde-empresa.test.ts`) y `ensanches-de-alcance.test.ts`. Sin base: solo texto fuente.
 */

/** Las funciones que AGRANDAN el alcance de un contexto (las cinco de `alcance.ts` y el ayudante de `con-permiso.ts` que pide el permiso y después ensancha). */
export const ENSANCHES_DEL_ALCANCE = ["conAlcanceEnSucursal", "lecturaEnSucursalesVisibles", "conEscrituraEnLaEmpresa", "incluirSucursalCreadaEnLaTransaccion", "lecturaDeVerificacionEnLaEmpresa", "permisoYAlcanceEnSucursal"] as const;
export type Ensanche = (typeof ENSANCHES_DEL_ALCANCE)[number];

export interface LlamadaAUnEnsanche {
  ensanche: Ensanche;
  /** La función de nivel de módulo (declarada o como constante) que contiene la llamada; `null` si está a nivel de módulo o dentro de otra cosa. */
  funcion: string | null;
  /** El texto de cada argumento. */
  argumentos: string[];
  /** Índice de la sentencia de primer nivel del cuerpo de `funcion` que contiene la llamada (-1 si no hay función). */
  sentencia: number;
}

/** Una función de nivel de módulo: su nombre y su cuerpo (solo si tiene cuerpo de bloque). */
function funcionDeNivelDeModulo(s: ts.Statement): { nombre: string; cuerpo: ts.Block } | null {
  if (ts.isFunctionDeclaration(s) && s.name && s.body) return { nombre: s.name.text, cuerpo: s.body };
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      const init = d.initializer;
      if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) return { nombre: d.name.text, cuerpo: init.body };
    }
  }
  return null;
}

/** Las funciones de nivel de módulo del código, por nombre. */
export function funcionesDelArchivo(codigo: string): Map<string, ts.Block> {
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const salida = new Map<string, ts.Block>();
  for (const s of sf.statements) {
    const f = funcionDeNivelDeModulo(s);
    if (f) salida.set(f.nombre, f.cuerpo);
  }
  return salida;
}

/** Todas las llamadas del código a las funciones de `nombres` (los comentarios no cuentan: es AST), cada una con la función que la contiene y la sentencia de primer nivel donde está. */
export function llamadasAEnsanches(codigo: string, nombres: readonly string[] = ENSANCHES_DEL_ALCANCE): LlamadaAUnEnsanche[] {
  if (!nombres.some((n) => codigo.includes(n))) return [];
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const salida: LlamadaAUnEnsanche[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && nombres.includes(n.expression.text)) {
      const nivel = sf.statements.find((s) => n.pos >= s.pos && n.end <= s.end);
      const f = nivel ? funcionDeNivelDeModulo(nivel) : null;
      salida.push({
        ensanche: n.expression.text as Ensanche,
        funcion: f?.nombre ?? null,
        argumentos: n.arguments.map((a) => a.getText(sf)),
        sentencia: f ? f.cuerpo.statements.findIndex((s) => n.pos >= s.pos && n.end <= s.end) : -1,
      });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return salida;
}

/** El índice de la primera sentencia de primer nivel de `cuerpo` que contiene una llamada a alguna de `nombres` (-1 si ninguna). */
function primeraSentenciaConLlamada(cuerpo: ts.Block, nombres: readonly string[]): number {
  return cuerpo.statements.findIndex((s) => {
    let halla = false;
    const visitar = (n: ts.Node): void => {
      if (halla) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && nombres.includes(n.expression.text)) halla = true;
      else ts.forEachChild(n, visitar);
    };
    visitar(s);
    return halla;
  });
}

/**
 * ¿La función `funcion` del código llama a algún `gates` en una sentencia de primer nivel ANTERIOR a la primera sentencia donde llama al ensanche `ensanche`? Es la regla «el ensanche va
 * DESPUÉS del gate». Falso si falta la función, el gate o el ensanche.
 */
export function ensancheDespuesDelGate(codigo: string, funcion: string, ensanche: Ensanche, gates: readonly string[]): boolean {
  const cuerpo = funcionesDelArchivo(codigo).get(funcion);
  if (!cuerpo) return false;
  const iEnsanche = primeraSentenciaConLlamada(cuerpo, [ensanche]);
  const iGate = primeraSentenciaConLlamada(cuerpo, gates);
  return iEnsanche >= 0 && iGate >= 0 && iGate < iEnsanche;
}

/** Los archivos `.ts`/`.tsx` de `dir` (recursivo): ruta relativa a `raiz` con barras normales → texto. */
export function fuentesDe(raiz: string, dir: string): Map<string, string> {
  const salida = new Map<string, string>();
  const recorrer = (d: string): void => {
    // `withFileTypes` da el tipo de cada entrada en la misma lectura del directorio: no se consulta la ruta aparte antes de abrirla (evita el patrón «comprobar y después usar»).
    for (const entrada of readdirSync(d, { withFileTypes: true })) {
      const nombre = entrada.name;
      const ruta = join(d, nombre);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (/\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts")) salida.set(relative(raiz, ruta).replace(/\\/g, "/"), readFileSync(ruta, "utf8"));
    }
  };
  recorrer(join(raiz, dir));
  return salida;
}

/**
 * Los ensanches de `nombres` que el código USA de cualquier manera: llamados, importados (con su nombre original aunque se renombre: `import { conEscrituraEnLaEmpresa as otro }`), reexportados, o traídos
 * con un `import * as` del módulo `alcance`. La dirección inversa de los guardianes mira esto y no solo las llamadas, para que un alias no esconda un ensanche.
 */
export function ensanchesUsados(codigo: string, nombres: readonly string[] = ENSANCHES_DEL_ALCANCE): string[] {
  if (!nombres.some((n) => codigo.includes(n)) && !/acceso\/alcance/.test(codigo)) return [];
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  const usados = new Set<string>(llamadasAEnsanches(codigo, nombres).map((l) => l.ensanche));
  const visitar = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) || ts.isExportSpecifier(n)) {
      const original = (n.propertyName ?? n.name).text;
      if (nombres.includes(original)) usados.add(original);
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /acceso\/alcance$/.test(n.moduleSpecifier.text) && n.importClause?.namedBindings && ts.isNamespaceImport(n.importClause.namedBindings)) usados.add("alcance(*)");
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return [...usados].sort();
}

/** El ensanche de SOLO LECTURA de los controles de verificación (P2): lectura en todas las sucursales de la empresa, escritura como estaba. */
export const ENSANCHE_DE_VERIFICACION = "lecturaDeVerificacionEnLaEmpresa";

export interface UsosDeLaBaseDeVerificacion {
  /** Cuántas veces se llama al ensanche. */
  llamadas: number;
  /** Cuántas de esas llamadas NO se guardan en una variable (`const x = await …`, también dentro de un condicional): la base ampliada tiene que tener nombre para poder seguirla. */
  sinVariable: number;
  /**
   * Cada uso de la base ampliada, como texto: `lector:<función>@<posición>` (`<x>.db` como argumento de una llamada a esa función), `directo:db.<modelo>.<operación>` (`<x>.db.<modelo>.<operación>(…)`),
   * `transaccion` (`<x>.transaccion(…)`), `transaccion-a:<función>@<posición>` (`<x>.transaccion` como argumento de esa función: `conTransaccionSerializable(<x>.transaccion, …)`), `contexto:<función>@<posición>` (`<x>` entera como argumento de
   * esa función: `conGobierno(<x>, …)`, que solo usa su `transaccion`) u `otro:<texto>` (cualquier otra cosa: pasar `<x>` entera, desestructurarla, guardar `<x>.db` en otra variable, leer su alcance…).
   */
  usos: string[];
}

/**
 * Lo que un archivo hace con la base que devuelve `lecturaDeVerificacionEnLaEmpresa` (P2): por AST, a qué lectores se la pasa y qué consultas directas arma con ella. Sigue las variables cuyo inicializador contiene la llamada
 * (`const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx)` o `cond ? await … : ctx`); un uso que no sea uno de los tres de arriba es `otro:` y el guardián lo rechaza. Los comentarios y las cadenas no cuentan.
 */
export function usosDeLaBaseDeVerificacion(codigo: string): UsosDeLaBaseDeVerificacion {
  if (!codigo.includes(ENSANCHE_DE_VERIFICACION)) return { llamadas: 0, sinVariable: 0, usos: [] };
  const sf = ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const variables = new Set<string>();
  let llamadas = 0;
  let sinVariable = 0;
  const buscarLlamadas = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ENSANCHE_DE_VERIFICACION) {
      llamadas++;
      let actual: ts.Node = n;
      while (actual.parent && (ts.isParenthesizedExpression(actual.parent) || ts.isAwaitExpression(actual.parent) || ts.isAsExpression(actual.parent) || (ts.isConditionalExpression(actual.parent) && actual.parent.condition !== actual))) actual = actual.parent;
      const padre = actual.parent;
      if (padre && ts.isVariableDeclaration(padre) && ts.isIdentifier(padre.name) && padre.initializer === actual) variables.add(padre.name.text);
      else sinVariable++;
    }
    ts.forEachChild(n, buscarLlamadas);
  };
  buscarLlamadas(sf);

  const usos: string[] = [];
  const clasificar = (id: ts.Identifier): string => {
    const p = id.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === id) {
      const pp = p.parent;
      if (p.name.text === "transaccion" && ts.isCallExpression(pp) && pp.expression === p) return "transaccion";
      if (p.name.text === "transaccion" && ts.isCallExpression(pp) && ts.isIdentifier(pp.expression)) {
        const posicion = pp.arguments.findIndex((a) => a === p);
        if (posicion >= 0) return `transaccion-a:${pp.expression.text}@${posicion}`;
      }
      if (p.name.text === "db") {
        // `<x>.db` como argumento de una función con nombre: un lector.
        if (ts.isCallExpression(pp) && pp.expression !== p && ts.isIdentifier(pp.expression)) {
          const posicion = pp.arguments.findIndex((a) => a === p);
          if (posicion >= 0) return `lector:${pp.expression.text}@${posicion}`;
        }
        // `<x>.db.<modelo>.<operación>(…)`: una consulta directa.
        if (ts.isPropertyAccessExpression(pp) && pp.expression === p) {
          const ppp = pp.parent;
          if (ts.isPropertyAccessExpression(ppp) && ppp.expression === pp && ts.isCallExpression(ppp.parent) && ppp.parent.expression === ppp) return `directo:db.${pp.name.text}.${ppp.name.text}`;
        }
      }
    }
    // `<x>` entera como argumento de una función con nombre.
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression !== id) {
      const posicion = p.arguments.findIndex((a) => a === id);
      if (posicion >= 0) return `contexto:${p.expression.text}@${posicion}`;
    }
    return `otro:${(ts.isPropertyAccessExpression(p) ? p : id).getText(sf)}`;
  };
  const buscarUsos = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && variables.has(n.text)) {
      const p = n.parent;
      const esDeclaracion = ts.isVariableDeclaration(p) && p.name === n;
      const esNombreDePropiedad = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!esDeclaracion && !esNombreDePropiedad) usos.push(clasificar(n));
    }
    ts.forEachChild(n, buscarUsos);
  };
  buscarUsos(sf);
  return { llamadas, sinVariable, usos };
}
