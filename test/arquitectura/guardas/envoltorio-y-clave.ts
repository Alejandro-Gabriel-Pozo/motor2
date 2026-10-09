import ts from "typescript";
import { analizarFuente } from "./analizador";

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

/**
 * El PUNTO CIEGO de `envoltoriosDe` (cierre del Hito 4, observación menor 3 de la auditoría independiente): una función exportada que no llama a ningún
 * envoltorio de mutación no aparece en su resultado, así que una mutación NUEVA abierta con otra guarda (p. ej. un `requerirVer*`, que solo pide el «Ver» de
 * la pantalla) o declarada como `export const … = async …` (que `envoltoriosDe` no mira) pasaba por al lado de los guardianes de envoltorio y clave
 * (`acciones-con-guarda` solo exige que tenga ALGUNA guarda). Esto devuelve TODAS las funciones exportadas que reconoce `analizarFuente` (también las
 * `export const`) que `envoltoriosDe` no ve, cada una con la guarda que la abre según `analizarFuente` (la importada, o la de la función del archivo en la que
 * delega) o, si no tiene, su estado (`sin-guarda`, `guarda-tardia`…). Los guardianes de cada dominio las comparan con su lista cerrada (`problemasSinEnvoltorio`).
 */
export function exportadasSinEnvoltorio(fuente: string): Record<string, string> {
  const conEnvoltorio = envoltoriosDe(fuente);
  const resultado: Record<string, string> = {};
  for (const f of analizarFuente("x.ts", fuente).funciones) {
    if (f.nombre in conEnvoltorio) continue;
    resultado[f.nombre] = f.estado === "ok" && f.guarda ? f.guarda : f.estado;
  }
  return resultado;
}

/**
 * Compara las exportadas sin envoltorio de UN archivo (`exportadasSinEnvoltorio`) con su lista cerrada: función → `"<guarda> — <motivo>"` (mismo formato que
 * `GUARDAS_A_MANO` de `acciones-con-guarda.test.ts`). Devuelve un problema por cada función sin declarar, por cada declarada que ya no está (o que ahora sí
 * llama a un envoltorio) y por cada una cuya guarda ya no es la anotada. Vacío = el archivo no tiene puntos ciegos.
 */
export function problemasSinEnvoltorio(encontradas: Record<string, string>, declaradas: Readonly<Record<string, string>>): string[] {
  const problemas: string[] = [];
  for (const [f, guarda] of Object.entries(encontradas)) {
    if (!(f in declaradas)) problemas.push(`${f}: exportada sin envoltorio de mutación y sin declarar (abre con ${guarda}); si es una mutación, abrila con su envoltorio y su clave; si no, declarala con su motivo`);
    else if (!declaradas[f].startsWith(`${guarda} — `)) problemas.push(`${f}: la guarda cambió (ahora ${guarda}; anotada: «${declaradas[f]}»)`);
  }
  for (const f of Object.keys(declaradas)) if (!(f in encontradas)) problemas.push(`${f}: declarada sin envoltorio pero ya no está así (no existe o ahora llama a un envoltorio): sacala de la lista`);
  return problemas;
}
