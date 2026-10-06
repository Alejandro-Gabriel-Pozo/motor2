import ts from "typescript";
import { describe, expect, it } from "vitest";
import { esDeGrupoProtegido, esPagina, leerDeApp, listarArchivosDeApp } from "./guardas/entradas-de-app";

/**
 * Regla de arquitectura (Fase 0 del plan de pureza, PR 0.8; hallazgo H9 de la auditoría): una página protegida SIN contexto de usuario manda al
 * login, no devuelve `null`.
 *
 * El layout de `(app)`/`(pos)` ya hace `if (!ctx) return irAlLogin()`, pero en una navegación del lado del cliente el layout NO se vuelve a dibujar
 * (guía «Layouts and auth checks» de Next): si la sesión venció a mitad del uso, la página recibía `ctx = null` y devolvía `null` → pantalla en blanco,
 * sin explicación y sin forma de volver. Es cerrado (no filtra nada) pero silencioso. Con `return irAlLogin()` la persona va al login recordando la
 * pantalla en la que estaba (y `/login` muestra el caso que corresponda: elegir empresa, empresa suspendida, sin acceso).
 *
 * Qué comprueba (AST, fuera de los comentarios), en toda página de `(app)`/`(pos)`:
 *  1. Ningún `if (!ctx)` termina en `return null`.
 *  2. Toda página que pide el contexto con `obtenerContextoUsuario()` llama a `irAlLogin()` si no lo obtiene.
 * Que la redirección funcione de verdad lo demuestran los e2e de sesión (`test/e2e/…`); acá se evita el olvido en una página nueva.
 */
const paginas = listarArchivosDeApp().filter((a) => esPagina(a) && esDeGrupoProtegido(a));

interface Lectura {
  retornaNullSinContexto: number[];
  piaElContexto: boolean;
  llamaAIrAlLogin: boolean;
}

function leer(codigo: string, ruta: string): Lectura {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const resultado: Lectura = { retornaNullSinContexto: [], piaElContexto: false, llamaAIrAlLogin: false };
  const esNegacionDeCtx = (e: ts.Expression) => ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(e.operand) && e.operand.text === "ctx";
  const esReturnNull = (s: ts.Statement): boolean => {
    if (ts.isReturnStatement(s)) return s.expression?.kind === ts.SyntaxKind.NullKeyword;
    return ts.isBlock(s) && s.statements.some(esReturnNull);
  };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isIfStatement(nodo) && esNegacionDeCtx(nodo.expression) && esReturnNull(nodo.thenStatement)) {
      resultado.retornaNullSinContexto.push(fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1);
    }
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression)) {
      if (nodo.expression.text === "obtenerContextoUsuario") resultado.piaElContexto = true;
      if (nodo.expression.text === "irAlLogin") resultado.llamaAIrAlLogin = true;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return resultado;
}

describe("páginas protegidas sin contexto: al login, no en blanco (el analizador ve la violación)", () => {
  it("detecta `if (!ctx) return null` (con o sin llaves) y no marca `if (!ctx) return irAlLogin()`", () => {
    const base = "export default async function P() { const ctx = await obtenerContextoUsuario(); ";
    expect(leer(`${base}if (!ctx) return null; return <p />; }`, "p.tsx").retornaNullSinContexto).toHaveLength(1);
    expect(leer(`${base}if (!ctx) { return null; } return <p />; }`, "p.tsx").retornaNullSinContexto).toHaveLength(1);
    expect(leer(`${base}if (!ctx) return irAlLogin(); return <p />; }`, "p.tsx").retornaNullSinContexto).toEqual([]);
    expect(leer(`${base}if (!ctx) return irAlLogin(); return <p />; }`, "p.tsx").llamaAIrAlLogin).toBe(true);
  });

  it("no marca un `return null` que no es por falta de contexto", () => {
    expect(leer("export default function P({ x }: { x: string | null }) { if (!x) return null; return <p />; }", "p.tsx").retornaNullSinContexto).toEqual([]);
  });
});

describe("páginas protegidas de (app)/(pos)", () => {
  it("encuentra las páginas (si dejan de encontrarse, la regla quedó vacía)", () => {
    expect(paginas.length).toBeGreaterThan(60);
  });

  it("ninguna devuelve null cuando no hay contexto (pantalla en blanco): va al login", () => {
    const violaciones = paginas.flatMap((p) => leer(leerDeApp(p), p).retornaNullSinContexto.map((linea) => `src/app/${p}:${linea}`));
    expect(violaciones, `Sin contexto, la página va al login: usá \`if (!ctx) return irAlLogin();\` (core/auth/ir-al-login).\n${violaciones.join("\n")}`).toEqual([]);
  });

  it("toda página que pide el contexto llama a irAlLogin() cuando no lo obtiene", () => {
    const sinLogin = paginas.filter((p) => {
      const l = leer(leerDeApp(p), p);
      return l.piaElContexto && !l.llamaAIrAlLogin;
    });
    expect(sinLogin, `Estas páginas piden el contexto pero no mandan al login si falta:\n${sinLogin.join("\n")}`).toEqual([]);
  });
});
