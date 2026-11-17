import ts from "typescript";
import { arbolDe } from "./cercos/trinquete";

/**
 * Detector del cerco «textos a mano» (T2 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, regla R6 / invariante IT-5). Cuenta, por archivo y por tipo, el texto que una persona lee y que
 * está ESCRITO a mano en el código en vez de salir del catálogo (`src/core/textos/`, `textoDe`):
 *  - `jsx-texto`: texto suelto entre etiquetas JSX (`<button>Guardar</button>`) y una cadena en una llave de JSX (`{"Guardar"}`);
 *  - `atributo-<nombre>`: un literal en `aria-label`, `placeholder`, `title`, `alt` o `label` (también dentro de una expresión: `title={ok ? "A" : "B"}` cuenta dos);
 *  - `mensaje-<función>`: un literal en el mensaje de `exito`, `fracaso`, `ok`, `okConId` o `error` (los de `core/resultado-caso.ts` y `server/actions/tipos.ts`).
 * Un literal cuenta si tiene al menos una letra (un `·`, un `—` o un número solo no son texto). Una plantilla con huecos cuenta UNA vez por su parte escrita. Lo que sale de `textoDe(...)` no cuenta (es una llamada).
 *
 * LÍMITES (honestos; es una alarma para errores honestos, no un límite de seguridad):
 *  - No ve un mensaje que llega por una variable, una constante o una función (`error(MENSAJE)`, `fracaso(c, mensajeDe(x))`): el texto de la constante se escribió en otro lugar.
 *  - No ve texto en datos (objetos y listas de rótulos, `descripcion:` de permisos, menús, `label:` dentro de un objeto) ni en atributos que no son los cinco de arriba (`aria-description`, `aria-placeholder`).
 *  - No ve un atributo que llega por propagación (`{...props}`), ni `title`/`label` de un componente propio con otro nombre de propiedad.
 *  - Una función con el nombre `error`/`ok` que no se importa de los dos archivos de arriba no cuenta (así `catch (error)` y `console.error(...)` no molestan); un alias (`import { error as fallar }`) sí se sigue.
 *  - Mira `src/` y `plataforma/src/`, sin `src/core/textos/` (el catálogo mismo). El texto de pruebas, scripts y de la carta pública armada con datos del cliente queda fuera.
 */
const ATRIBUTOS_DE_TEXTO = ["aria-label", "placeholder", "title", "alt", "label"] as const;
/** Función de mensaje → posición del argumento que es el mensaje. */
const FUNCIONES_DE_MENSAJE: Readonly<Record<string, number>> = { exito: 0, fracaso: 1, ok: 0, okConId: 0, error: 0 };
const ARCHIVOS_DE_MENSAJES = /(?:^|\/)(?:resultado-caso|tipos)$/;
const TIENE_LETRA = /\p{L}/u;

/**
 * Cuántos literales con letras hay en `nodo` en posición DIRECTA: el literal mismo, las ramas de un `? :`, de un `&&`/`||`/`??` y los dos lados de un `+`, entre paréntesis o con `as`/`!`, y las partes escritas
 * de una plantilla (más sus huecos, con la misma regla). NO entra a una llamada ni a una función: `textoDe(...)` es el catálogo, y `cn("flex gap-2")` o un `.map(...)` no son texto que una persona lea.
 */
function contarLiterales(nodo: ts.Node): number {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return TIENE_LETRA.test(nodo.text) ? 1 : 0;
  if (ts.isTemplateExpression(nodo)) {
    const partes = [nodo.head.text, ...nodo.templateSpans.map((s) => s.literal.text)];
    let n = partes.some((p) => TIENE_LETRA.test(p)) ? 1 : 0;
    for (const span of nodo.templateSpans) n += contarLiterales(span.expression);
    return n;
  }
  if (ts.isParenthesizedExpression(nodo) || ts.isAsExpression(nodo) || ts.isNonNullExpression(nodo) || ts.isSatisfiesExpression(nodo)) return contarLiterales(nodo.expression);
  if (ts.isConditionalExpression(nodo)) return contarLiterales(nodo.whenTrue) + contarLiterales(nodo.whenFalse);
  if (ts.isBinaryExpression(nodo)) {
    const operador = nodo.operatorToken.kind;
    if (operador === ts.SyntaxKind.PlusToken || operador === ts.SyntaxKind.BarBarToken || operador === ts.SyntaxKind.QuestionQuestionToken) return contarLiterales(nodo.left) + contarLiterales(nodo.right);
    if (operador === ts.SyntaxKind.AmpersandAmpersandToken) return contarLiterales(nodo.right);
  }
  return 0;
}

/** Los nombres locales con que el archivo importa las funciones de mensaje de sus dos archivos de origen (`{ error as fallar }` → `fallar` → `error`). */
function funcionesImportadas(archivo: ts.SourceFile): Map<string, string> {
  const salida = new Map<string, string>();
  for (const sentencia of archivo.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    if (!ARCHIVOS_DE_MENSAJES.test(sentencia.moduleSpecifier.text)) continue;
    const enlaces = sentencia.importClause?.namedBindings;
    if (!enlaces || !ts.isNamedImports(enlaces)) continue;
    for (const e of enlaces.elements) {
      const original = (e.propertyName ?? e.name).text;
      if (original in FUNCIONES_DE_MENSAJE) salida.set(e.name.text, original);
    }
  }
  return salida;
}

export function contarTextosAMano(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = {};
  const sumar = (tipo: string, n: number): void => {
    if (n > 0) cuenta[tipo] = (cuenta[tipo] ?? 0) + n;
  };
  const archivo = arbolDe(fuente, ruta);
  const importadas = funcionesImportadas(archivo);
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxText(nodo) && TIENE_LETRA.test(nodo.text)) sumar("jsx-texto", 1);
    else if (ts.isJsxExpression(nodo) && nodo.expression && !ts.isJsxAttribute(nodo.parent)) sumar("jsx-texto", contarLiterales(nodo.expression));
    else if (ts.isJsxAttribute(nodo) && nodo.initializer) {
      const nombre = nodo.name.getText();
      if ((ATRIBUTOS_DE_TEXTO as readonly string[]).includes(nombre)) sumar(`atributo-${nombre}`, contarLiterales(ts.isJsxExpression(nodo.initializer) ? (nodo.initializer.expression ?? nodo.initializer) : nodo.initializer));
    } else if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
      const funcion = importadas.get(nodo.expression.text);
      const argumento = funcion === undefined ? undefined : nodo.arguments[FUNCIONES_DE_MENSAJE[funcion]!];
      if (funcion !== undefined && argumento) sumar(`mensaje-${funcion}`, contarLiterales(argumento));
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(archivo);
  return cuenta;
}
