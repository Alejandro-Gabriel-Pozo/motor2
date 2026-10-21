import { posix } from "node:path";
import ts from "typescript";
import { colapsar, prueba, type Coincidencia } from "./coincidencia";

/**
 * Adaptador de TypeScript: usos y definiciones de símbolos, e imports del ancla. Todo sobre el AST (con padres) o sobre el CÓDIGO del archivo: el texto sin comentarios
 * y sin el interior de los strings, las plantillas ni los regex literales, para que una mención en un comentario o en un texto no sea un uso.
 */

/** Reemplaza `[desde, hasta)` por espacios, conservando los saltos de línea (las posiciones no cambian). */
function blanquear(texto: string, rangos: readonly [number, number][]): string {
  const partes: string[] = [];
  let cursor = 0;
  for (const [desde, hasta] of [...rangos].sort((a, b) => a[0] - b[0])) {
    if (desde < cursor || hasta <= desde) continue;
    partes.push(texto.slice(cursor, desde), texto.slice(desde, hasta).replace(/[^\n]/g, " "));
    cursor = hasta;
  }
  partes.push(texto.slice(cursor));
  return partes.join("");
}

/** El código del archivo: `limpia` (sin comentarios) con el interior de los literales en blanco. Las comillas y los `${` quedan; las posiciones no cambian. */
export function codigoSolo(limpia: string, arbol: ts.SourceFile): string {
  const rangos: [number, number][] = [];
  const visitar = (nodo: ts.Node): void => {
    switch (nodo.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateTail:
        rangos.push([nodo.getStart(arbol) + 1, nodo.end - 1]);
        return;
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
        rangos.push([nodo.getStart(arbol) + 1, nodo.end - 2]);
        return;
      case ts.SyntaxKind.RegularExpressionLiteral:
      case ts.SyntaxKind.JsxText:
        rangos.push([nodo.getStart(arbol), nodo.end]);
        return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return blanquear(limpia, rangos);
}

export type DetectorTs =
  | { tipo: "codigo"; patron: RegExp }
  | { tipo: "propiedad"; nombre: RegExp; valor: RegExp }
  | { tipo: "declara"; nombre: RegExp };

/** Lo que el adaptador necesita de un archivo TS: su fuente, su código y su AST (todos de la misma versión del texto). */
export interface ArchivoTs {
  fuente: string;
  codigo: string;
  arbol: ts.SourceFile;
}

/**
 * Las declaraciones de un archivo (nombre y posición de cada función, clase, interfaz, tipo, enum o variable), en el orden del recorrido, memorizadas por AST. El AST ya viene memorizado entre
 * corridas (`arbolMemoizado`), así que el arnés de mutaciones, que corre el motor cientos de veces con varios contratos que buscan declaraciones (las primitivas de `src/ui`), recorre cada archivo
 * UNA vez y no una por contrato y por corrida. Es una caché pura: el resultado es el mismo que recorrer el árbol cada vez.
 */
const declaracionesMemo = new WeakMap<ts.SourceFile, readonly { nombre: string; desde: number }[]>();
function declaracionesDe(arbol: ts.SourceFile): readonly { nombre: string; desde: number }[] {
  let lista = declaracionesMemo.get(arbol);
  if (lista === undefined) {
    const acumulada: { nombre: string; desde: number }[] = [];
    const recorrer = (nodo: ts.Node): void => {
      const nombre = nombreDeclarado(nodo);
      if (nombre) acumulada.push({ nombre: nombre.text, desde: nombre.getStart(arbol) });
      ts.forEachChild(nodo, recorrer);
    };
    recorrer(arbol);
    lista = acumulada;
    declaracionesMemo.set(arbol, lista);
  }
  return lista;
}

const coincidenciasDeDeclaraMemo = new WeakMap<ts.SourceFile, Map<string, readonly Coincidencia[]>>();

export function coincidenciasDeTs(archivo: ArchivoTs, detector: DetectorTs): Coincidencia[] {
  const { fuente, codigo, arbol } = archivo;
  const salida: Coincidencia[] = [];

  if (detector.tipo === "codigo") {
    const patron = new RegExp(detector.patron.source, detector.patron.flags.includes("g") ? detector.patron.flags : `${detector.patron.flags}g`);
    for (const m of codigo.matchAll(patron)) {
      if (m[0] === "") continue;
      salida.push({ desde: m.index, fragmento: colapsar(fuente.slice(m.index, m.index + m[0].length)), nombre: m[1] ?? m[0], companeras: [] });
    }
    return salida;
  }

  const visitar = (nodo: ts.Node): void => {
    if (detector.tipo === "propiedad" && ts.isPropertyAssignment(nodo) && (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name) || ts.isNoSubstitutionTemplateLiteral(nodo.name))) {
      if (prueba(detector.nombre, nodo.name.text) && prueba(detector.valor, nodo.initializer.getText(arbol))) {
        salida.push({ desde: nodo.getStart(arbol), fragmento: colapsar(nodo.getText(arbol)), nombre: nodo.name.text, companeras: [] });
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  if (detector.tipo === "declara") {
    // Lo que un nombre busca en un archivo no cambia mientras el AST (memorizado por texto) sea el mismo: se guarda por expresión.
    const clave = `${detector.nombre.source}/${detector.nombre.flags}`;
    let porNombre = coincidenciasDeDeclaraMemo.get(arbol);
    if (porNombre === undefined) {
      porNombre = new Map();
      coincidenciasDeDeclaraMemo.set(arbol, porNombre);
    }
    let guardadas = porNombre.get(clave);
    if (guardadas === undefined) {
      guardadas = declaracionesDe(arbol)
        .filter((d) => prueba(detector.nombre, d.nombre))
        .map((d) => ({ desde: d.desde, fragmento: d.nombre, nombre: d.nombre, companeras: [] as readonly string[] }));
      porNombre.set(clave, guardadas);
    }
    return [...guardadas];
  }
  visitar(arbol);
  return salida;
}

/** El identificador que declara un nodo (función, clase, interfaz, tipo, enum, variable), o undefined. */
function nombreDeclarado(nodo: ts.Node): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(nodo) || ts.isClassDeclaration(nodo) || ts.isInterfaceDeclaration(nodo) || ts.isTypeAliasDeclaration(nodo) || ts.isEnumDeclaration(nodo)) return nodo.name;
  if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name)) return nodo.name;
  return undefined;
}

const modificadores = (nodo: ts.Node): readonly ts.ModifierLike[] => (ts.canHaveModifiers(nodo) ? (ts.getModifiers(nodo) ?? []) : []);

/** La posición donde el archivo exporta `nombre` (declaración exportada, `export { nombre }`, `export default` para `"default"`), o null. */
export function posicionDelSimboloExportado(arbol: ts.SourceFile, nombre: string): number | null {
  for (const s of arbol.statements) {
    if (ts.isExportAssignment(s)) {
      if (nombre === "default") return s.getStart(arbol);
      continue;
    }
    if (ts.isExportDeclaration(s)) {
      if (s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.some((e) => e.name.text === nombre)) return s.getStart(arbol);
      continue;
    }
    const mods = modificadores(s);
    if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (nombre === "default") return s.getStart(arbol);
      continue;
    }
    if (ts.isVariableStatement(s)) {
      if (s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === nombre)) return s.getStart(arbol);
      continue;
    }
    const declarado = nombreDeclarado(s);
    if (declarado?.text === nombre) return s.getStart(arbol);
  }
  return null;
}

/** Las rutas a las que puede apuntar un especificador de import hecho desde `desde` (`@/x` es `src/x`). Vacío para un paquete externo. */
function candidatosDelImport(desde: string, especificador: string): string[] {
  let base: string;
  if (especificador.startsWith("@/")) base = posix.join("src", especificador.slice(2));
  else if (especificador.startsWith(".")) base = posix.join(posix.dirname(desde), especificador);
  else return [];
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
}

export interface ImportDelAncla {
  /** Dónde está el import. */
  desde: number;
  /** Si el archivo usa el ancla (la llama, la lee o la pasa) además de importarla. */
  usada: boolean;
}

/**
 * La declaración «importar el ancla»: el archivo importa `ancla` de `archivoDeLaFuente` (nombrado, con alias, por defecto, o por `import * as ns` si usa `ns.ancla`).
 * Un `import` de otro símbolo de la misma fuente no declara nada. Null si no declara.
 */
export function importaElAncla(arbol: ts.SourceFile, rutaDelArchivo: string, archivoDeLaFuente: string, ancla: string): ImportDelAncla | null {
  // Función pura del AST (memorizado por texto entre corridas del arnés) y de sus tres parámetros: se guarda por AST.
  const clave = `${rutaDelArchivo}|${archivoDeLaFuente}|${ancla}`;
  let guardadas = importesDelAnclaMemo.get(arbol);
  if (guardadas === undefined) {
    guardadas = new Map();
    importesDelAnclaMemo.set(arbol, guardadas);
  }
  if (guardadas.has(clave)) return guardadas.get(clave) ?? null;
  const resultado = calcularImportDelAncla(arbol, rutaDelArchivo, archivoDeLaFuente, ancla);
  guardadas.set(clave, resultado);
  return resultado;
}

const importesDelAnclaMemo = new WeakMap<ts.SourceFile, Map<string, ImportDelAncla | null>>();

function calcularImportDelAncla(arbol: ts.SourceFile, rutaDelArchivo: string, archivoDeLaFuente: string, ancla: string): ImportDelAncla | null {
  const locales = new Set<string>();
  const espacios = new Set<string>();
  let desde = -1;
  for (const s of arbol.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause) continue;
    if (!candidatosDelImport(rutaDelArchivo, s.moduleSpecifier.text).includes(archivoDeLaFuente)) continue;
    const { name, namedBindings } = s.importClause;
    const marca = (nodo: ts.Node): void => {
      if (desde < 0) desde = nodo.getStart(arbol);
    };
    if (name && ancla === "default") {
      locales.add(name.text);
      marca(name);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const e of namedBindings.elements) {
        if ((e.propertyName ?? e.name).text !== ancla) continue;
        locales.add(e.name.text);
        marca(e);
      }
    } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      espacios.add(namedBindings.name.text);
      marca(namedBindings);
    }
  }
  if (locales.size === 0 && espacios.size === 0) return null;

  let usada = false;
  let accesoPorEspacio = false;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportDeclaration(nodo)) return;
    if (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && espacios.has(nodo.expression.text) && nodo.name.text === ancla) {
      accesoPorEspacio = true;
      usada = true;
    } else if (ts.isIdentifier(nodo) && locales.has(nodo.text)) {
      const padre = nodo.parent;
      const esNombreAjeno = (ts.isPropertyAccessExpression(padre) && padre.name === nodo) || (ts.isPropertyAssignment(padre) && padre.name === nodo);
      if (!esNombreAjeno) usada = true;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  // Un `import * as ns` solo declara si el archivo usa `ns.ancla`; los imports nombrados declaran por sí solos.
  if (locales.size === 0 && !accesoPorEspacio) return null;
  return { desde, usada };
}
