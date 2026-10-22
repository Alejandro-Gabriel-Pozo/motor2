import ts from "typescript";
import { colapsar, prueba, type Coincidencia } from "./coincidencia";

/**
 * Adaptador de clases (Tailwind y `className`) sobre el AST de TypeScript. Una CADENA de clases es un literal de texto del archivo (un string, una plantilla sin
 * sustituciones o una plantilla con `${…}`, cuyas partes fijas se juntan): ahí viven los atributos `className`, las constantes de clases y los `cn(…)`. Los comentarios
 * no existen para el AST. No se miran los especificadores de `import`/`export` ni los tipos literales.
 *
 * Las posiciones salen del texto crudo del archivo: el motor informa el token que molesta, no el principio del literal.
 */
export interface TokenDeClase {
  /** El token sin variantes (`sm:`, `hover:`, `[&>li]:`) ni `!`. */
  base: string;
  desde: number;
}

export interface CadenaDeClases {
  /** Los tokens separados por un espacio: es el fragmento con el que se declara una excepción. */
  texto: string;
  tokens: readonly TokenDeClase[];
}

/** El token sin las variantes (lo que va antes de un `:` que no está entre corchetes o paréntesis) ni el `!` de importante, delante o detrás. */
export function sinVariantes(token: string): string {
  let profundidad = 0;
  let corte = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") profundidad++;
    else if (c === "]" || c === ")") profundidad = Math.max(0, profundidad - 1);
    else if (c === ":" && profundidad === 0) corte = i;
  }
  return token.slice(corte + 1).replace(/^!/, "").replace(/!$/, "");
}

/** Todas las cadenas de clases de un archivo, en orden de aparición. `fuente` es el mismo texto que parseó `arbol`. */
export function cadenasDeClases(arbol: ts.SourceFile, fuente: string): CadenaDeClases[] {
  const cadenas: CadenaDeClases[] = [];

  const armar = (partes: readonly [number, number][]): void => {
    const tokens: TokenDeClase[] = [];
    for (const [a, b] of partes) {
      for (const m of fuente.slice(a, b).matchAll(/\S+/g)) tokens.push({ base: sinVariantes(m[0]), desde: a + m.index });
    }
    if (tokens.length === 0) return;
    cadenas.push({ texto: colapsar(partes.map(([a, b]) => fuente.slice(a, b)).join(" ")), tokens });
  };

  const esEspecificador = (nodo: ts.Node): boolean => {
    const padre = nodo.parent;
    return padre !== undefined && (ts.isImportDeclaration(padre) || ts.isExportDeclaration(padre) || ts.isLiteralTypeNode(padre) || ts.isExternalModuleReference(padre) || ts.isImportTypeNode(padre));
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
      if (!esEspecificador(nodo)) armar([[nodo.getStart(arbol) + 1, nodo.end - 1]]);
      return;
    }
    if (ts.isTemplateExpression(nodo)) {
      const partes: [number, number][] = [[nodo.head.getStart(arbol) + 1, nodo.head.end - 2]];
      for (const s of nodo.templateSpans) partes.push([s.literal.getStart(arbol) + 1, s.literal.end - (ts.isTemplateTail(s.literal) ? 1 : 2)]);
      armar(partes);
      // Lo que va en `${…}` es código: puede traer más cadenas.
      for (const s of nodo.templateSpans) visitar(s.expression);
      return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return cadenas;
}

/** Una coincidencia por cadena y detector: la del primer token que cumple (la cadena es lo que se arregla). */
export function coincidenciasDeClases(cadenas: readonly CadenaDeClases[], token: RegExp): Coincidencia[] {
  const salida: Coincidencia[] = [];
  for (const cadena of cadenas) {
    const primero = cadena.tokens.find((t) => prueba(token, t.base));
    if (primero) salida.push({ desde: primero.desde, fragmento: cadena.texto, nombre: primero.base, companeras: cadena.tokens.map((t) => t.base) });
  }
  return salida;
}

/**
 * Una coincidencia por TOKEN de cada cadena (no solo el primero): para un contrato cuyo uso es un nombre dentro de la clase (`bg-papel` usa el token `--color-papel`). El token
 * se compara SIN variantes (`hover:bg-papel` casa como `bg-papel`) y tiene que traer el grupo con nombre `(?<nombre>…)`; el nombre de la coincidencia es `prefijo + grupos.nombre`.
 * La posición es la del token tal como está escrito en el archivo (con sus variantes): ahí apunta el hallazgo. El fragmento es la cadena entera, como en `coincidenciasDeClases`.
 */
export function coincidenciasPorToken(cadenas: readonly CadenaDeClases[], token: RegExp, prefijo: string): Coincidencia[] {
  const salida: Coincidencia[] = [];
  for (const cadena of cadenas) {
    for (const t of cadena.tokens) {
      token.lastIndex = 0;
      const m = token.exec(t.base);
      token.lastIndex = 0;
      if (m) salida.push({ desde: t.desde, fragmento: cadena.texto, nombre: `${prefijo}${m.groups?.nombre ?? ""}`, companeras: cadena.tokens.map((x) => x.base) });
    }
  }
  return salida;
}

/** La posición del primer token `clase` de cualquier cadena (la declaración de un consumidor), o null. */
export function primeraClase(cadenas: readonly CadenaDeClases[], clase: string): number | null {
  for (const cadena of cadenas) {
    const t = cadena.tokens.find((x) => x.base === clase);
    if (t) return t.desde;
  }
  return null;
}
