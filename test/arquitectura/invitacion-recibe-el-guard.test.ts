import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * La aceptación de una invitación de usuario recibe el guard por parámetro y la ÚNICA llamada de producción le pasa el `requierePermiso` REAL del gate
 * (Pureza Fase 3, tramo B; ADR-024, E8).
 *
 * `aceptarInvitacionDeUsuarioDelToken` revalida, por cada sucursal, que quien otorgó la invitación TODAVÍA puede gestionar usuarios (módulos, capacidades y rol). Para que
 * `core` no importe el guard (que lee la base y vive en el servidor), el guard entra como parámetro. Eso abre un riesgo: que alguien le pase uno de mentira
 * (`async () => ({ ok: true })`) y la revalidación quede anulada sin que ningún test de comportamiento lo note. Este test lo cierra: en `src/` hay UNA llamada y su segundo
 * argumento es el identificador `requierePermiso` importado del gate.
 */
const SRC = join(__dirname, "../../src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

interface Llamada {
  archivo: string;
  linea: number;
  segundoArgumento: string | null;
  vieneDelGate: boolean;
}

function llamadasDe(codigo: string, ruta: string): Llamada[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // de dónde viene cada identificador importado
  const origen = new Map<string, string>();
  for (const st of fuente.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) origen.set(el.name.text, st.moduleSpecifier.text);
    }
  }
  const llamadas: Llamada[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "aceptarInvitacionDeUsuarioDelToken") {
      const segundo = n.arguments[1];
      const nombre = segundo && ts.isIdentifier(segundo) ? segundo.text : null;
      llamadas.push({
        archivo: relative(SRC, ruta).split(sep).join("/"),
        linea: fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1,
        segundoArgumento: segundo ? segundo.getText(fuente) : null,
        vieneDelGate: nombre === "requierePermiso" && /(^|\/)(permisos|acceso)\/gate$/.test(origen.get(nombre) ?? ""),
      });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return llamadas;
}

describe("la invitación de usuario recibe el guard real", () => {
  it("hay exactamente UNA llamada de producción y le pasa el requierePermiso del gate", () => {
    const llamadas = archivos(SRC).flatMap((f) => llamadasDe(readFileSync(f, "utf8"), f));
    expect(llamadas.map((l) => `${l.archivo}:${l.linea} (${l.segundoArgumento})`)).toHaveLength(1);
    const [unica] = llamadas;
    expect(unica!.vieneDelGate, `${unica!.archivo}:${unica!.linea} tiene que pasar el requierePermiso importado del gate, no ${unica!.segundoArgumento}`).toBe(true);
  });

  it("el detector (con fuentes sintéticas)", () => {
    const real = 'import { requierePermiso } from "@/core/permisos/gate";\nawait aceptarInvitacionDeUsuarioDelToken({ token }, requierePermiso);';
    const falso = 'import { requierePermiso } from "@/core/permisos/gate";\nawait aceptarInvitacionDeUsuarioDelToken({ token }, async () => ({ ok: true }));';
    const otro = 'import { requierePermiso } from "./mio";\nawait aceptarInvitacionDeUsuarioDelToken({ token }, requierePermiso);';
    const nuevo = 'import { requierePermiso } from "@/server/acceso/gate";\nawait aceptarInvitacionDeUsuarioDelToken({ token }, requierePermiso);';
    expect(llamadasDe(real, join(SRC, "x.ts"))[0]!.vieneDelGate).toBe(true);
    expect(llamadasDe(falso, join(SRC, "x.ts"))[0]!.vieneDelGate).toBe(false);
    expect(llamadasDe(otro, join(SRC, "x.ts"))[0]!.vieneDelGate).toBe(false);
    expect(llamadasDe(nuevo, join(SRC, "x.ts"))[0]!.vieneDelGate).toBe(true);
  });
});
