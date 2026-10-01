import ts from "typescript";

/**
 * Analizador AST (no textual) de la guarda de acceso de las Server Actions.
 * Reemplaza el enfoque por regex de `acciones-con-guarda.test.ts`, que no
 * distingue un nombre de guarda dentro de un comentario o un string de una
 * llamada real, ni detecta una guarda cuyo resultado se descarta (sin
 * `await`) o que llega después de una lectura de base.
 *
 * Deliberadamente NO usa un `ts.Program`/`TypeChecker`: solo resuelve
 * identificadores contra los `import` del propio archivo y contra las
 * funciones exportadas del propio archivo (para la delegación, ej.
 * `guardarReceta`/`obtenerRecetaVigente` en recetas.ts). No sigue
 * re-exports ni alias entre archivos — no hace falta hoy (ver plan).
 */

export type EstadoFuncion = "ok" | "sin-guarda" | "guarda-tardia" | "guarda-descartada" | "export-no-reconocido";

export interface FuncionAnalizada {
  nombre: string;
  linea: number;
  estado: EstadoFuncion;
}

export interface ResultadoAnalisis {
  esArchivoDeAcciones: boolean;
  funciones: FuncionAnalizada[];
}

/** Nombres de guarda reconocidos, por el módulo del que se importan (sufijo del specifier). */
const GUARDAS_POR_MODULO: Record<string, string[]> = {
  "con-permiso": ["conPermiso", "conPermisoDeEmpresa"],
  "con-sesion": ["requerirSesion", "requerirSesionEnSucursal", "requerirVer", "requerirVerEnSucursal", "requerirVerDeEmpresa"],
  "core/auth/contexto": ["obtenerContextoUsuario"],
  "core/auth/session": ["getUsuarioActual"],
  "core/permisos/gate": ["requierePermiso", "requierePermisoVer", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa"],
};

interface FuncionCandidata {
  nombre: string;
  linea: number;
  cuerpo: ts.Block | undefined;
  /** Para una arrow function de cuerpo-expresión (sin bloque): la expresión misma, tratada como "return implícito". */
  cuerpoExpresion: ts.Expression | undefined;
}

function nombreDeModulo(especificador: string): string | undefined {
  return Object.keys(GUARDAS_POR_MODULO).find((m) => especificador === m || especificador.endsWith(`/${m}`));
}

/** Nombres LOCALES (soporta alias de import) que refieren a una guarda reconocida. */
function nombresDeGuardaImportados(sourceFile: ts.SourceFile): Set<string> {
  const nombres = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const modulo = nombreDeModulo(stmt.moduleSpecifier.text);
    if (!modulo) continue;
    const permitidos = new Set(GUARDAS_POR_MODULO[modulo]);
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const importado = (el.propertyName ?? el.name).text;
        if (permitidos.has(importado)) nombres.add(el.name.text);
      }
    }
  }
  return nombres;
}

function tieneModificador(nodo: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
  return (ts.getModifiers(nodo) ?? []).some((m) => m.kind === kind);
}

/** Recorre TODO el subárbol de una sentencia buscando un `await` o un acceso a `prisma.` — a cualquier profundidad. */
function tieneAwaitOAccesoPrisma(nodo: ts.Node): boolean {
  if (ts.isAwaitExpression(nodo)) return true;
  if (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "prisma") return true;
  let encontrado = false;
  ts.forEachChild(nodo, (hijo) => {
    if (!encontrado && tieneAwaitOAccesoPrisma(hijo)) encontrado = true;
  });
  return encontrado;
}

type UsoLlamada = "usado" | "descartado";

/** Extrae, de una sentencia de primer nivel, la expresión candidata a ser la llamada de guarda, y cómo se usa su resultado. */
function candidataDeSentencia(stmt: ts.Statement): { expresion: ts.Expression; uso: UsoLlamada } | undefined {
  if (ts.isReturnStatement(stmt) && stmt.expression) return { expresion: stmt.expression, uso: "usado" };
  if (ts.isVariableStatement(stmt)) {
    const decl = stmt.declarationList.declarations.find((d) => d.initializer);
    if (decl?.initializer) return { expresion: decl.initializer, uso: "usado" };
    return undefined;
  }
  if (ts.isExpressionStatement(stmt)) return { expresion: stmt.expression, uso: "descartado" };
  return undefined;
}

/** Desenvuelve un `await` si está presente; devuelve la expresión interna y si estaba envuelta. */
function desenvolverAwait(expr: ts.Expression): { interna: ts.Expression; awaited: boolean } {
  if (ts.isAwaitExpression(expr)) return { interna: expr.expression, awaited: true };
  return { interna: expr, awaited: false };
}

function nombreDelCallee(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

export function analizarFuente(nombreArchivo: string, fuente: string): ResultadoAnalisis {
  const sourceFile = ts.createSourceFile(nombreArchivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const primera = sourceFile.statements[0];
  const esArchivoDeAcciones =
    !!primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === "use server";

  const guardas = nombresDeGuardaImportados(sourceFile);

  // Todas las funciones exportadas del archivo (candidatas a chequeo Y a delegación).
  const candidatas = new Map<string, FuncionCandidata>();
  // Entradas que no se pudieron reconocer como función (forma de export desconocida) — nunca se saltean en silencio.
  const noReconocidas: FuncionAnalizada[] = [];

  function registrar(nombre: string, linea: number, cuerpo: ts.Block | undefined, cuerpoExpresion: ts.Expression | undefined) {
    candidatas.set(nombre, { nombre, linea, cuerpo, cuerpoExpresion });
  }

  function lineaDe(nodo: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(nodo.getStart(sourceFile)).line + 1;
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && tieneModificador(stmt, ts.SyntaxKind.ExportKeyword)) {
      registrar(stmt.name.text, lineaDe(stmt), stmt.body, undefined);
      continue;
    }
    if (ts.isVariableStatement(stmt) && tieneModificador(stmt, ts.SyntaxKind.ExportKeyword)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          if (ts.isBlock(init.body)) registrar(decl.name.text, lineaDe(stmt), init.body, undefined);
          else registrar(decl.name.text, lineaDe(stmt), undefined, init.body);
        }
        // Un `export const` que no inicializa con una función (una constante de datos) no es un endpoint: se ignora.
      }
      continue;
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        if (ts.isBlock(expr.body)) registrar("default", lineaDe(stmt), expr.body, undefined);
        else registrar("default", lineaDe(stmt), undefined, expr.body);
      } else {
        noReconocidas.push({ nombre: "default", linea: lineaDe(stmt), estado: "export-no-reconocido" });
      }
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      // `export * from ...` o `export { x } from "otro-modulo"`: no se puede resolver localmente — se marca, nunca se ignora.
      if (stmt.moduleSpecifier || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        noReconocidas.push({ nombre: "*", linea: lineaDe(stmt), estado: "export-no-reconocido" });
        continue;
      }
      for (const el of stmt.exportClause.elements) {
        noReconocidas.push({ nombre: el.name.text, linea: lineaDe(stmt), estado: "export-no-reconocido" });
      }
    }
  }

  const memo = new Map<string, EstadoFuncion>();

  function evaluarLlamada(candidataExpr: ts.Expression, uso: UsoLlamada, visitados: Set<string>): EstadoFuncion | undefined {
    const { interna, awaited } = desenvolverAwait(candidataExpr);
    if (!ts.isCallExpression(interna)) return undefined;
    const nombreCallee = nombreDelCallee(interna);
    if (!nombreCallee) return undefined;

    if (guardas.has(nombreCallee)) {
      return uso === "descartado" && !awaited ? "guarda-descartada" : "ok";
    }
    if (candidatas.has(nombreCallee)) {
      const estadoDelegado = evaluarFuncion(nombreCallee, visitados);
      if (estadoDelegado !== "ok") return undefined; // el delegado no está bien guardado: esta llamada no cuenta como guardia acá.
      return uso === "descartado" && !awaited ? "guarda-descartada" : "ok";
    }
    return undefined;
  }

  function evaluarFuncion(nombre: string, visitados: Set<string>): EstadoFuncion {
    const memoizado = memo.get(nombre);
    if (memoizado) return memoizado;
    if (visitados.has(nombre)) return "sin-guarda"; // ciclo de delegación: conservador.
    visitados.add(nombre);

    const fn = candidatas.get(nombre);
    if (!fn) return "sin-guarda";

    if (fn.cuerpoExpresion) {
      const estado = evaluarLlamada(fn.cuerpoExpresion, "usado", visitados) ?? "sin-guarda";
      memo.set(nombre, estado);
      return estado;
    }
    const stmts = fn.cuerpo?.statements ?? [];
    let indiceGuarda = -1;
    let estadoEnGuarda: EstadoFuncion = "sin-guarda";
    for (let i = 0; i < stmts.length; i++) {
      const candidata = candidataDeSentencia(stmts[i]);
      if (!candidata) continue;
      const estado = evaluarLlamada(candidata.expresion, candidata.uso, visitados);
      if (estado) {
        indiceGuarda = i;
        estadoEnGuarda = estado;
        break;
      }
    }
    if (indiceGuarda === -1) {
      memo.set(nombre, "sin-guarda");
      return "sin-guarda";
    }
    if (estadoEnGuarda === "guarda-descartada") {
      memo.set(nombre, "guarda-descartada");
      return "guarda-descartada";
    }
    for (let i = 0; i < indiceGuarda; i++) {
      if (tieneAwaitOAccesoPrisma(stmts[i])) {
        memo.set(nombre, "guarda-tardia");
        return "guarda-tardia";
      }
    }
    memo.set(nombre, "ok");
    return "ok";
  }

  const funciones: FuncionAnalizada[] = [...candidatas.values()].map((f) => ({
    nombre: f.nombre,
    linea: f.linea,
    estado: evaluarFuncion(f.nombre, new Set()),
  }));

  return { esArchivoDeAcciones, funciones: [...funciones, ...noReconocidas] };
}
