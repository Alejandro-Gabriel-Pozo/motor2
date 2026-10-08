import ts from "typescript";

/**
 * Analizador AST del ENVOLTORIO Y LA CLAVE con que entra cada Server Action de mutación (Hito 3, paso 0.4: nació en `gobierno-envoltorio-y-clave.test.ts`;
 * Hito 4, paso 0.3 de `docs/plan-hito-4-pureza.md`: se extrajo acá, tal cual, para que lo use también `pos-envoltorio-y-clave.test.ts`).
 *
 * Por cada función EXPORTADA del archivo que llama a un envoltorio de mutación (`conPermiso`, `conPermisoDeEmpresa`, `conEdicionDePermisos`) devuelve
 * `<envoltorio>:<clave>` si su PRIMERA sentencia es `return <envoltorio>("<clave>", …)` (el guard antes que todo), o el motivo por el que no tiene esa forma.
 * Las lecturas (que no llaman envoltorios de mutación), las funciones no exportadas y lo comentado no entran.
 */
const ENVOLTORIOS = new Set(["conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos"]);

export type Envoltorio = "conPermiso" | "conPermisoDeEmpresa" | "conEdicionDePermisos";

interface Encontrada {
  /** `<envoltorio>:<clave>` de la primera sentencia, o el motivo por el que no tiene esa forma. */
  entrada: string;
}

function nombreDeLlamada(llamada: ts.CallExpression): string | null {
  return ts.isIdentifier(llamada.expression) ? llamada.expression.text : null;
}

function llamaAUnEnvoltorio(nodo: ts.Node): boolean {
  let encontro = false;
  const visitar = (n: ts.Node): void => {
    if (encontro) return;
    if (ts.isCallExpression(n) && ENVOLTORIOS.has(nombreDeLlamada(n) ?? "")) encontro = true;
    else ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return encontro;
}

/** Funciones exportadas que llaman a un envoltorio de mutación, con el envoltorio y la clave de su primera sentencia. */
export function envoltoriosDe(fuente: string): Record<string, Encontrada> {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const resultado: Record<string, Encontrada> = {};
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (!llamaAUnEnvoltorio(stmt.body)) continue;
    const primera = stmt.body.statements[0];
    const llamada = primera && ts.isReturnStatement(primera) && primera.expression && ts.isCallExpression(primera.expression) ? primera.expression : null;
    const envoltorio = llamada ? nombreDeLlamada(llamada) : null;
    const clave = llamada?.arguments[0];
    resultado[stmt.name.text] = {
      entrada:
        !llamada || !envoltorio || !ENVOLTORIOS.has(envoltorio)
          ? "la primera sentencia no es `return <envoltorio>(…)`"
          : !clave || !ts.isStringLiteral(clave)
            ? `${envoltorio}: la clave no es un literal`
            : `${envoltorio}:${clave.text}`,
    };
  }
  return resultado;
}
