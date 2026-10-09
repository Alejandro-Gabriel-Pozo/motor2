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
  /**
   * Con `estado: "ok"`, el nombre IMPORTADO (no el alias local) de la guarda que la abre; si delega en otra función exportada del archivo, la guarda
   * de esa función. Sirve para la lista cerrada de guardas «puestas a mano» (`acciones-con-guarda.test.ts`, pre-paso P de la Fase I-B del Hito 3).
   */
  guarda?: string;
}

export interface ResultadoAnalisis {
  esArchivoDeAcciones: boolean;
  funciones: FuncionAnalizada[];
}

/** Nombres de guarda reconocidos, por el módulo del que se importan (sufijo del specifier). */
const GUARDAS_POR_MODULO: Record<string, string[]> = {
  "con-permiso": ["conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos"],
  "con-sesion": ["requerirVer", "requerirVerEnSucursal", "requerirVerDeEmpresa", "requerirVerAlguna", "requerirVerAlgunaEnSucursal"],
  "core/auth/contexto": ["obtenerContextoUsuario"],
  "core/auth/session": ["getUsuarioActual"],
  // Acciones previas al login (E5): su control de acceso es conocer el token de la invitación, que `invitacionDelToken` valida contra la base antes de cualquier escritura.
  "server/sesion/invitacion": ["invitacionDelToken"],
  "server/acceso/gate": ["requierePermiso", "requierePermisoVer", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa"],
};

interface FuncionCandidata {
  nombre: string;
  linea: number;
  cuerpo: ts.Block | undefined;
  /** Para una arrow function de cuerpo-expresión (sin bloque): la expresión misma, tratada como "return implícito". */
  cuerpoExpresion: ts.Expression | undefined;
  /** `export const x = conPermiso("clave", …)`: el propio envoltorio es la guarda reconocida (nombre importado). */
  guardaDelEnvoltorio?: string;
}

/**
 * Pela lo que no cambia QUÉ es una expresión: paréntesis, `as`, `satisfies`, `!` y `<T>x`. Sin esto, `(async () => {}) as Accion` o
 * `conRegistro(…)!` se leían como «algo que no es una función» y la exportación desaparecía del inventario (I-2 de la auditoría final).
 */
function pelarExpresion(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
    else return e;
  }
}

const esFuncionLiteral = (e: ts.Node): e is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(e) || ts.isFunctionExpression(e);

/**
 * La función que de verdad define una acción exportada con `export const x = <inicializador>`: la propia función (pelada de paréntesis, `as`, `satisfies`, `!`), o
 * la PRIMERA función literal que recibe una llamada-envoltorio (`conRegistro(async (id) => …)`, también anidada: `a(b(async () => …))`). `undefined` si no hay ninguna.
 * Los inventarios de acciones (GT-1, GT-4, GT-11 y el analizador de guardas) la usan para ver los parámetros y el cuerpo de las acciones exportadas como constante.
 */
export function funcionDeInicializador(init: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const e = pelarExpresion(init);
  if (esFuncionLiteral(e)) return e;
  if (ts.isCallExpression(e)) {
    for (const arg of e.arguments) {
      const interna = funcionDeInicializador(arg);
      if (interna) return interna;
    }
  }
  return undefined;
}

/** Constructores de valores de datos puros: `export const X = new Set([...])` no es un endpoint. */
const NEW_DE_DATOS = new Set(["Set", "Map", "WeakSet", "WeakMap", "Date", "RegExp", "URL", "URLSearchParams", "Array"]);

function contieneFuncion(nodo: ts.Node): boolean {
  if (ts.isArrowFunction(nodo) || ts.isFunctionExpression(nodo) || ts.isFunctionDeclaration(nodo) || ts.isMethodDeclaration(nodo) || ts.isGetAccessor(nodo) || ts.isSetAccessor(nodo)) return true;
  let hay = false;
  ts.forEachChild(nodo, (h) => {
    if (!hay && contieneFuncion(h)) hay = true;
  });
  return hay;
}

/**
 * ¿Es CLARAMENTE una constante de datos (literal, objeto, arreglo, plantilla, `new Set(…)`, número negativo…) y no una acción disfrazada? Un literal que lleva una función
 * adentro (`{ borrar: async () => … }`), un identificador (puede ser un alias de una función) o cualquier otra forma NO lo es: en un archivo `"use server"` queda como
 * `export-no-reconocido` y el guard central se pone en rojo (I-2 de la auditoría final: antes se ignoraba en silencio y la acción quedaba fuera de todos los inventarios).
 */
function esConstanteDeDatos(init: ts.Expression): boolean {
  const e = pelarExpresion(init);
  if (contieneFuncion(e)) return false;
  if (
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    ts.isRegularExpressionLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isTemplateExpression(e) || ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) return esConstanteDeDatos(e.operand);
  if (ts.isNewExpression(e)) return ts.isIdentifier(e.expression) && NEW_DE_DATOS.has(e.expression.text);
  if (ts.isIdentifier(e)) return e.text === "undefined";
  return false;
}

/** El prólogo de directivas de un archivo o de un cuerpo de función: las sentencias iniciales que son un string literal. ¿Alguna es `"use server"`? */
function prologoTieneUseServer(sentencias: readonly ts.Statement[]): boolean {
  for (const s of sentencias) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
    if (s.expression.text === "use server") return true;
  }
  return false;
}

/**
 * ¿La fuente es un archivo `"use server"` (directiva de ARCHIVO, en el prólogo del AST)? Es la única forma de decidirlo: un regex tipo `/^\s*["']use server["']/` pierde el
 * archivo si algo (un comentario, un banner) va antes de la directiva, y entonces ese archivo sale del alcance de todo guard que lo filtre así (I-2 de la auditoría final).
 */
export function esArchivoUseServer(fuente: string, nombreArchivo = "x.ts"): boolean {
  return prologoTieneUseServer(ts.createSourceFile(nombreArchivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements);
}

/** Lo mismo que `esArchivoUseServer`, o una directiva `"use server"` en el cuerpo de alguna función del archivo (una Server Action en línea de una página). */
export function tieneUseServer(fuente: string, nombreArchivo = "x.ts"): boolean {
  const sf = ts.createSourceFile(nombreArchivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (prologoTieneUseServer(sf.statements)) return true;
  let hay = false;
  const visitar = (n: ts.Node): void => {
    if (hay) return;
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body && ts.isBlock(n.body) && prologoTieneUseServer(n.body.statements)) {
      hay = true;
      return;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return hay;
}

function nombreDeModulo(especificador: string): string | undefined {
  return Object.keys(GUARDAS_POR_MODULO).find((m) => especificador === m || especificador.endsWith(`/${m}`));
}

/** Nombres LOCALES (soporta alias de import) que refieren a una guarda reconocida, con el nombre importado de cada uno. */
function nombresDeGuardaImportados(sourceFile: ts.SourceFile): Map<string, string> {
  const nombres = new Map<string, string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const modulo = nombreDeModulo(stmt.moduleSpecifier.text);
    if (!modulo) continue;
    const permitidos = new Set(GUARDAS_POR_MODULO[modulo]);
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const importado = (el.propertyName ?? el.name).text;
        if (permitidos.has(importado)) nombres.set(el.name.text, importado);
      }
    }
  }
  return nombres;
}

function tieneModificador(nodo: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
  return (ts.getModifiers(nodo) ?? []).some((m) => m.kind === kind);
}

/**
 * `await headers()` / `await cookies()` (los pedidos de metadatos de Next, sin argumentos): leer las cabeceras o las cookies del propio pedido no es una lectura de datos, y una
 * guarda anónima con cupo por origen (S-27: `abrirInvitacion` consulta el cupo de la IP ANTES de ir a la base) las necesita antes de llegar a la guarda. Cualquier otro `await` sigue
 * marcando la guarda como tardía.
 */
function esPedidoDeMetadatosDeNext(nodo: ts.AwaitExpression): boolean {
  const interna = nodo.expression;
  return ts.isCallExpression(interna) && interna.arguments.length === 0 && ts.isIdentifier(interna.expression) && ["headers", "cookies"].includes(interna.expression.text);
}

/** Recorre TODO el subárbol de una sentencia buscando un `await` o un acceso a `prisma.` — a cualquier profundidad. */
function tieneAwaitOAccesoPrisma(nodo: ts.Node): boolean {
  if (ts.isAwaitExpression(nodo)) return !esPedidoDeMetadatosDeNext(nodo);
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

  const esArchivoDeAcciones = prologoTieneUseServer(sourceFile.statements);

  const guardas = nombresDeGuardaImportados(sourceFile);

  // Todas las funciones exportadas del archivo (candidatas a chequeo Y a delegación).
  const candidatas = new Map<string, FuncionCandidata>();
  // Entradas que no se pudieron reconocer como función (forma de export desconocida) — nunca se saltean en silencio.
  const noReconocidas: FuncionAnalizada[] = [];

  function registrar(nombre: string, linea: number, cuerpo: ts.Block | undefined, cuerpoExpresion: ts.Expression | undefined) {
    candidatas.set(nombre, { nombre, linea, cuerpo, cuerpoExpresion });
  }

  /** El nombre importado de la guarda reconocida que es la llamada misma o una llamada anidada entre sus argumentos (`a(conPermiso("k", …))`), o `undefined`. */
  function guardaDeLlamadaEnvoltorio(call: ts.CallExpression): string | undefined {
    const nombreCallee = nombreDelCallee(call);
    const propia = nombreCallee ? guardas.get(nombreCallee) : undefined;
    if (propia) return propia;
    for (const arg of call.arguments) {
      const a = pelarExpresion(arg);
      if (ts.isCallExpression(a)) {
        const anidada = guardaDeLlamadaEnvoltorio(a);
        if (anidada) return anidada;
      }
    }
    return undefined;
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
        if (!decl.initializer) continue;
        if (!ts.isIdentifier(decl.name)) {
          // `export const { a, b } = algo`: en un archivo "use server" cada nombre sería un endpoint que no se puede resolver acá — nunca se saltea en silencio.
          if (esArchivoDeAcciones) noReconocidas.push({ nombre: "*", linea: lineaDe(stmt), estado: "export-no-reconocido" });
          continue;
        }
        const nombre = decl.name.text;
        const init = pelarExpresion(decl.initializer);
        if (esFuncionLiteral(init)) {
          if (ts.isBlock(init.body)) registrar(nombre, lineaDe(stmt), init.body, undefined);
          else registrar(nombre, lineaDe(stmt), undefined, init.body);
          continue;
        }
        if (!esArchivoDeAcciones) continue; // fuera de un archivo "use server" un `export const` que no es una función no es un endpoint.
        if (ts.isCallExpression(init)) {
          // Envoltorio: `export const borrar = conRegistro(async (id) => …)`. Es una acción a inventariar. Si la propia llamada (o una anidada) es una guarda reconocida, esa es su
          // guarda; si no, se evalúa el cuerpo de la primera función que recibe, exigiéndole la guarda como a cualquier otra; si no hay ninguna función, queda sin guarda.
          const guardaDelEnvoltorio = guardaDeLlamadaEnvoltorio(init);
          const interna = funcionDeInicializador(init);
          const linea = lineaDe(stmt);
          if (guardaDelEnvoltorio) candidatas.set(nombre, { nombre, linea, cuerpo: undefined, cuerpoExpresion: undefined, guardaDelEnvoltorio });
          else if (interna && ts.isBlock(interna.body)) registrar(nombre, linea, interna.body, undefined);
          else if (interna && !ts.isBlock(interna.body)) registrar(nombre, linea, undefined, interna.body);
          else registrar(nombre, linea, undefined, undefined);
          continue;
        }
        // Una constante de datos clara (literal, objeto, arreglo, `new Set(…)`) no es un endpoint; cualquier otra forma (alias, condicional, `await`, …) no se reconoce.
        if (!esConstanteDeDatos(init)) noReconocidas.push({ nombre, linea: lineaDe(stmt), estado: "export-no-reconocido" });
      }
      continue;
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = pelarExpresion(stmt.expression);
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
  /** La guarda (nombre importado) que abre cada función que quedó "ok", directa o por delegación. */
  const guardaDe = new Map<string, string>();
  /** La guarda de la última llamada que `evaluarLlamada` reconoció (la lee `evaluarFuncion` justo después). */
  let guardaReconocida: string | undefined;

  function evaluarLlamada(candidataExpr: ts.Expression, uso: UsoLlamada, visitados: Set<string>): EstadoFuncion | undefined {
    const { interna, awaited } = desenvolverAwait(candidataExpr);
    if (!ts.isCallExpression(interna)) return undefined;
    const nombreCallee = nombreDelCallee(interna);
    if (!nombreCallee) return undefined;

    const importada = guardas.get(nombreCallee);
    if (importada) {
      guardaReconocida = importada;
      return uso === "descartado" && !awaited ? "guarda-descartada" : "ok";
    }
    if (candidatas.has(nombreCallee)) {
      const estadoDelegado = evaluarFuncion(nombreCallee, visitados);
      if (estadoDelegado !== "ok") return undefined; // el delegado no está bien guardado: esta llamada no cuenta como guardia acá.
      guardaReconocida = guardaDe.get(nombreCallee);
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

    if (fn.guardaDelEnvoltorio) {
      guardaDe.set(nombre, fn.guardaDelEnvoltorio);
      memo.set(nombre, "ok");
      return "ok";
    }
    if (fn.cuerpoExpresion) {
      guardaReconocida = undefined;
      const estado = evaluarLlamada(fn.cuerpoExpresion, "usado", visitados) ?? "sin-guarda";
      if (estado === "ok" && guardaReconocida) guardaDe.set(nombre, guardaReconocida);
      memo.set(nombre, estado);
      return estado;
    }
    const stmts = fn.cuerpo?.statements ?? [];
    let indiceGuarda = -1;
    let estadoEnGuarda: EstadoFuncion = "sin-guarda";
    let guardaEnGuarda: string | undefined;
    for (let i = 0; i < stmts.length; i++) {
      const candidata = candidataDeSentencia(stmts[i]);
      if (!candidata) continue;
      guardaReconocida = undefined;
      const estado = evaluarLlamada(candidata.expresion, candidata.uso, visitados);
      if (estado) {
        indiceGuarda = i;
        estadoEnGuarda = estado;
        guardaEnGuarda = guardaReconocida;
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
    if (guardaEnGuarda) guardaDe.set(nombre, guardaEnGuarda);
    memo.set(nombre, "ok");
    return "ok";
  }

  const funciones: FuncionAnalizada[] = [...candidatas.values()].map((f) => {
    const estado = evaluarFuncion(f.nombre, new Set());
    const guarda = estado === "ok" ? guardaDe.get(f.nombre) : undefined;
    return { nombre: f.nombre, linea: f.linea, estado, ...(guarda && { guarda }) };
  });

  return { esArchivoDeAcciones, funciones: [...funciones, ...noReconocidas] };
}
