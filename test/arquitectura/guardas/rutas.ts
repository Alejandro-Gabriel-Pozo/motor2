import ts from "typescript";

/**
 * Analizador AST de las ENTRADAS HTTP de `src/app`: páginas (`page.tsx`), route handlers (`route.ts`) y layouts. Mismo estilo que
 * `analizador.ts` (el de las Server Actions): sin `ts.Program`, solo el árbol del propio archivo y los `import` para resolver nombres.
 *
 * Qué protege: en Next una `page.tsx` o un `route.ts` nuevo nace PÚBLICO. El layout de `(app)`/`(pos)` redirige al login, pero (a) un
 * `route.ts` no pasa por ningún layout y (b) el layout solo decide si hay sesión: el permiso de cada pantalla lo decide la propia página.
 * Por eso cada página protegida tiene que abrir con la guarda de `core/permisos/gate` y cortar si no hay permiso, ANTES de leer nada, y cada
 * cron tiene que rechazar el pedido sin el secreto antes de tocar la base.
 */

const GUARDAS_DE_PAGINA = ["requierePermiso", "requierePermisoVer", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa"];
const MODULO_GATE = "core/permisos/gate";
const MODULO_SECRETO_CRON = "core/auth/secreto-cron";
const MODULO_CONTEXTO = "core/auth/contexto";
const MODULO_IR_AL_LOGIN = "core/auth/ir-al-login";
const METODOS_HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type EstadoPagina =
  | "ok"
  | "sin-guarda"
  | "guarda-tardia"
  | "guarda-descartada"
  | "guarda-sin-corte"
  | "sin-export-por-defecto"
  | "export-no-reconocido";

type EstadoCron = "ok" | "sin-guarda" | "guarda-tardia" | "sin-metodos" | "export-no-reconocido";

type EstadoLayout = "ok" | "sin-contexto" | "sin-corte" | "sin-export-por-defecto" | "export-no-reconocido";

interface ResultadoPagina {
  estado: EstadoPagina;
  linea: number;
}

interface MetodoCronAnalizado {
  nombre: string;
  linea: number;
  estado: Exclude<EstadoCron, "sin-metodos">;
}

function parsear(nombreArchivo: string, fuente: string): ts.SourceFile {
  return ts.createSourceFile(nombreArchivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function lineaDe(sf: ts.SourceFile, nodo: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1;
}

function tieneModificador(nodo: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
  return (ts.getModifiers(nodo) ?? []).some((m) => m.kind === kind);
}

/** Nombres LOCALES (soporta alias) de lo importado de un módulo, restringido a los nombres permitidos. */
function importadosDe(sf: ts.SourceFile, modulo: string, permitidos: string[]): Set<string> {
  const locales = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (spec !== modulo && !spec.endsWith(`/${modulo}`)) continue;
    const enlaces = stmt.importClause.namedBindings;
    if (!enlaces || !ts.isNamedImports(enlaces)) continue;
    for (const el of enlaces.elements) {
      if ((permitidos.length === 0 || permitidos.includes((el.propertyName ?? el.name).text)) && !el.isTypeOnly) {
        locales.add(el.name.text);
      }
    }
  }
  return locales;
}

type CuerpoDeFuncion = { cuerpo: ts.Block; linea: number };

/** Resuelve el `export default` de una página/layout a un cuerpo de función con bloque. */
function cuerpoDelExportPorDefecto(sf: ts.SourceFile): CuerpoDeFuncion | "sin-export" | "no-reconocido" {
  const locales = new Map<string, ts.Block>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) locales.set(stmt.name.text, stmt.body);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && ts.isBlock(d.initializer.body)) {
          locales.set(d.name.text, d.initializer.body);
        }
      }
    }
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && tieneModificador(stmt, ts.SyntaxKind.ExportKeyword) && tieneModificador(stmt, ts.SyntaxKind.DefaultKeyword)) {
      return stmt.body ? { cuerpo: stmt.body, linea: lineaDe(sf, stmt) } : "no-reconocido";
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const e = stmt.expression;
      if ((ts.isArrowFunction(e) || ts.isFunctionExpression(e)) && ts.isBlock(e.body)) return { cuerpo: e.body, linea: lineaDe(sf, stmt) };
      if (ts.isIdentifier(e) && locales.has(e.text)) return { cuerpo: locales.get(e.text)!, linea: lineaDe(sf, stmt) };
      return "no-reconocido";
    }
  }
  return "sin-export";
}

/** Recorre un subárbol SIN entrar en funciones anidadas (closures `"use server"`, callbacks): lo que hay adentro no corre al renderizar. */
function recorrerEjecutado(nodo: ts.Node, visitar: (n: ts.Node) => void): void {
  if (ts.isFunctionDeclaration(nodo)) return; // una declaración suelta no corre hasta que alguien la llama
  visitar(nodo);
  ts.forEachChild(nodo, (hijo) => {
    const esFuncion = ts.isArrowFunction(hijo) || ts.isFunctionExpression(hijo) || ts.isFunctionDeclaration(hijo) || ts.isMethodDeclaration(hijo);
    if (esFuncion) {
      // Una función invocada en el acto (IIFE) sí corre: se entra.
      let envoltorio: ts.Node = hijo;
      while (envoltorio.parent && ts.isParenthesizedExpression(envoltorio.parent)) envoltorio = envoltorio.parent;
      const llamador = envoltorio.parent;
      const esIife = !!llamador && ts.isCallExpression(llamador) && llamador.expression === envoltorio;
      if (!esIife) return;
    }
    recorrerEjecutado(hijo, visitar);
  });
}

function nombreDelCallee(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

function esAwaitDeParametroDeRuta(expr: ts.AwaitExpression): boolean {
  const e = expr.expression;
  if (ts.isIdentifier(e)) return e.text === "params" || e.text === "searchParams";
  if (ts.isPropertyAccessExpression(e)) return e.name.text === "params" || e.name.text === "searchParams";
  return false;
}

/** ¿La sentencia, antes de la guarda, lee algo (base, red, otra función asíncrona)? Solo se admite esperar `params`/`searchParams` y el contexto. */
function leeAntesDeLaGuarda(stmt: ts.Statement, contexto: Set<string>): boolean {
  let lee = false;
  recorrerEjecutado(stmt, (n) => {
    if (lee) return;
    if (ts.isIdentifier(n) && n.text === "prisma") lee = true;
    if (ts.isAwaitExpression(n)) {
      const interna = n.expression;
      const esContexto = ts.isCallExpression(interna) && !!nombreDelCallee(interna) && contexto.has(nombreDelCallee(interna)!);
      if (!esContexto && !esAwaitDeParametroDeRuta(n)) lee = true;
    }
  });
  return lee;
}

function cortaSiNoOk(stmt: ts.Statement, variable: string): boolean {
  if (!ts.isIfStatement(stmt)) return false;
  const esNegacionDeOk = (e: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(e)) return esNegacionDeOk(e.expression);
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
      const o = e.operand;
      return ts.isPropertyAccessExpression(o) && o.name.text === "ok" && ts.isIdentifier(o.expression) && o.expression.text === variable;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return esNegacionDeOk(e.left) || esNegacionDeOk(e.right);
    return false;
  };
  if (!esNegacionDeOk(stmt.expression)) return false;
  const rama = stmt.thenStatement;
  const terminal = (s: ts.Statement) => ts.isReturnStatement(s) || ts.isThrowStatement(s);
  if (terminal(rama)) return true;
  return ts.isBlock(rama) && rama.statements.length > 0 && terminal(rama.statements[rama.statements.length - 1]);
}

export function analizarPagina(nombreArchivo: string, fuente: string): ResultadoPagina {
  const sf = parsear(nombreArchivo, fuente);
  const resuelto = cuerpoDelExportPorDefecto(sf);
  if (resuelto === "sin-export") return { estado: "sin-export-por-defecto", linea: 1 };
  if (resuelto === "no-reconocido") return { estado: "export-no-reconocido", linea: 1 };

  const guardas = importadosDe(sf, MODULO_GATE, GUARDAS_DE_PAGINA);
  const contexto = new Set([...importadosDe(sf, MODULO_CONTEXTO, ["obtenerContextoUsuario"]), ...importadosDe(sf, "core/auth/session", ["getUsuarioActual"])]);
  const stmts = resuelto.cuerpo.statements;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    let llamada: ts.Expression | undefined;
    let variable: string | undefined;
    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      llamada = decl?.initializer;
      if (decl && ts.isIdentifier(decl.name)) variable = decl.name.text;
    } else if (ts.isExpressionStatement(stmt)) {
      llamada = stmt.expression;
    } else if (ts.isReturnStatement(stmt)) {
      llamada = stmt.expression;
    }
    if (!llamada) continue;
    const esperada = ts.isAwaitExpression(llamada);
    const interna: ts.Expression = ts.isAwaitExpression(llamada) ? llamada.expression : llamada;
    if (!ts.isCallExpression(interna)) continue;
    const callee = nombreDelCallee(interna);
    if (!callee || !guardas.has(callee)) continue;

    for (let j = 0; j < i; j++) {
      if (leeAntesDeLaGuarda(stmts[j], contexto)) return { estado: "guarda-tardia", linea: lineaDe(sf, stmt) };
    }
    if (!esperada || !variable) return { estado: "guarda-descartada", linea: lineaDe(sf, stmt) };
    const siguiente = stmts[i + 1];
    if (!siguiente || !cortaSiNoOk(siguiente, variable)) return { estado: "guarda-sin-corte", linea: lineaDe(sf, stmt) };
    return { estado: "ok", linea: lineaDe(sf, stmt) };
  }
  return { estado: "sin-guarda", linea: resuelto.linea };
}

/** Un route handler de cron: cada método HTTP exportado tiene que rechazar el pedido sin el secreto antes de usar la base. */
export function analizarCron(nombreArchivo: string, fuente: string): { estado: EstadoCron; metodos: MetodoCronAnalizado[] } {
  const sf = parsear(nombreArchivo, fuente);
  const validar = importadosDe(sf, MODULO_SECRETO_CRON, ["autorizacionCronValida"]);
  const metodos: MetodoCronAnalizado[] = [];

  function analizarCuerpo(nombre: string, linea: number, cuerpo: ts.Block) {
    const stmts = cuerpo.statements;
    for (let i = 0; i < stmts.length; i++) {
      if (!esRechazoSinSecreto(stmts[i], validar)) continue;
      for (let j = 0; j < i; j++) {
        if (usaLaBaseAntesDelSecreto(stmts[j])) {
          metodos.push({ nombre, linea, estado: "guarda-tardia" });
          return;
        }
      }
      metodos.push({ nombre, linea, estado: "ok" });
      return;
    }
    metodos.push({ nombre, linea, estado: "sin-guarda" });
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && METODOS_HTTP.includes(stmt.name.text) && tieneModificador(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (stmt.body) analizarCuerpo(stmt.name.text, lineaDe(sf, stmt), stmt.body);
      else metodos.push({ nombre: stmt.name.text, linea: lineaDe(sf, stmt), estado: "export-no-reconocido" });
    } else if (ts.isVariableStatement(stmt) && tieneModificador(stmt, ts.SyntaxKind.ExportKeyword)) {
      for (const d of stmt.declarationList.declarations) {
        const nombres = ts.isIdentifier(d.name) ? [d.name.text] : ts.isObjectBindingPattern(d.name) ? d.name.elements.map((e) => (ts.isIdentifier(e.name) ? e.name.text : "")) : [];
        const metodo = nombres.filter((n) => METODOS_HTTP.includes(n));
        if (metodo.length === 0) continue;
        const init = d.initializer;
        if (init && ts.isIdentifier(d.name) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) {
          analizarCuerpo(d.name.text, lineaDe(sf, stmt), init.body);
        } else {
          for (const m of metodo) metodos.push({ nombre: m, linea: lineaDe(sf, stmt), estado: "export-no-reconocido" });
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      const nombres = stmt.exportClause && ts.isNamedExports(stmt.exportClause) ? stmt.exportClause.elements.map((e) => e.name.text) : ["*"];
      const hayMetodo = nombres.includes("*") || nombres.some((n) => METODOS_HTTP.includes(n));
      if (hayMetodo) metodos.push({ nombre: nombres.join(","), linea: lineaDe(sf, stmt), estado: "export-no-reconocido" });
    }
  }

  if (metodos.length === 0) return { estado: "sin-metodos", metodos };
  const peor = metodos.find((m) => m.estado !== "ok");
  return { estado: peor ? peor.estado : "ok", metodos };
}

function esRechazoSinSecreto(stmt: ts.Statement, validar: Set<string>): boolean {
  if (!ts.isIfStatement(stmt)) return false;
  let cond = stmt.expression;
  while (ts.isParenthesizedExpression(cond)) cond = cond.expression;
  if (!ts.isPrefixUnaryExpression(cond) || cond.operator !== ts.SyntaxKind.ExclamationToken) return false;
  let operando: ts.Expression = cond.operand;
  while (ts.isParenthesizedExpression(operando)) operando = operando.expression;
  if (!ts.isCallExpression(operando)) return false;
  const callee = nombreDelCallee(operando);
  if (!callee || !validar.has(callee)) return false;
  const rama = stmt.thenStatement;
  const terminal = (s: ts.Statement) => ts.isReturnStatement(s) || ts.isThrowStatement(s);
  return terminal(rama) || (ts.isBlock(rama) && rama.statements.length > 0 && terminal(rama.statements[rama.statements.length - 1]));
}

/** Antes de validar el secreto solo se admite avisar la mala configuración (`reportarErrorUnaVez`): ni la base ni otro `await`. */
function usaLaBaseAntesDelSecreto(stmt: ts.Statement): boolean {
  let usa = false;
  recorrerEjecutado(stmt, (n) => {
    if (usa) return;
    if (ts.isIdentifier(n) && (n.text === "prisma" || n.text === "baseDelContexto" || n.text === "db")) usa = true;
    if (ts.isAwaitExpression(n)) {
      const interna = n.expression;
      const permitido = ts.isCallExpression(interna) && nombreDelCallee(interna) === "reportarErrorUnaVez";
      if (!permitido) usa = true;
    }
  });
  return usa;
}

/** Un layout protegido: abre con `const ctx = await obtenerContextoUsuario()` y, sin contexto, redirige con `irAlLogin()`. */
export function analizarLayoutProtegido(nombreArchivo: string, fuente: string): EstadoLayout {
  const sf = parsear(nombreArchivo, fuente);
  const resuelto = cuerpoDelExportPorDefecto(sf);
  if (resuelto === "sin-export") return "sin-export-por-defecto";
  if (resuelto === "no-reconocido") return "export-no-reconocido";

  const contexto = importadosDe(sf, MODULO_CONTEXTO, ["obtenerContextoUsuario"]);
  const irAlLogin = importadosDe(sf, MODULO_IR_AL_LOGIN, ["irAlLogin"]);
  const stmts = resuelto.cuerpo.statements;

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (!ts.isVariableStatement(stmt)) continue;
    const decl = stmt.declarationList.declarations[0];
    const init = decl?.initializer;
    if (!decl || !ts.isIdentifier(decl.name) || !init || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) continue;
    const callee = nombreDelCallee(init.expression);
    if (!callee || !contexto.has(callee)) continue;

    const variable = decl.name.text;
    const siguiente = stmts[i + 1];
    if (!siguiente || !ts.isIfStatement(siguiente)) return "sin-corte";
    const cond = siguiente.expression;
    const niegaElContexto = ts.isPrefixUnaryExpression(cond) && cond.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(cond.operand) && cond.operand.text === variable;
    if (!niegaElContexto) return "sin-corte";
    let llamaAlLogin = false;
    recorrerEjecutado(siguiente.thenStatement, (n) => {
      if (ts.isCallExpression(n) && nombreDelCallee(n) && irAlLogin.has(nombreDelCallee(n)!)) llamaAlLogin = true;
    });
    return llamaAlLogin ? "ok" : "sin-corte";
  }
  return "sin-contexto";
}
