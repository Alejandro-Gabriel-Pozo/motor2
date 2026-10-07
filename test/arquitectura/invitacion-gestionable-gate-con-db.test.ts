import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Hito 3, Fase I, I.5g: `invitacionGestionable` (el paso compartido de revocar y reenviar una invitación) pide el gate REAL de las otras sucursales
 * (`requierePermiso`, `server/acceso/gate.ts`) con `actor.db`, el cliente de la empresa, y NO con la transacción `tx` de gobierno, como lo hacía la Server Action
 * antes de migrar (`ctx.db`): la decisión de acceso no corre dentro de la transacción serializable (no le suma lecturas ni conflictos de serialización, y la decide el
 * mismo guard que el resto de la aplicación, con el mismo cliente). Los tipos no lo distinguen (`tx` también es un `Db`) y ningún test de comportamiento lo ve: lo fija
 * este guardián por AST.
 */
const ARCHIVO = join(__dirname, "../../src/server/actions/auth/casos-de-uso/invitacion-gestionable.ts");

/** El cuarto argumento (el cliente) de cada llamada a `requierePermiso` del fuente, como texto. */
export function clientesDelGate(fuente: string): string[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const clientes: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requierePermiso") clientes.push(n.arguments[3]?.getText(sf) ?? "(sin cliente)");
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return clientes;
}

describe("invitacionGestionable: el gate de las otras sucursales se pide con actor.db, no con la transacción", () => {
  it("toda llamada a requierePermiso pasa actor.db (y hay al menos una)", () => {
    const clientes = clientesDelGate(readFileSync(ARCHIVO, "utf8"));
    expect(clientes.length).toBeGreaterThan(0);
    expect(clientes.filter((c) => c !== "actor.db"), "requierePermiso con otro cliente que actor.db (¿la transacción de gobierno?)").toEqual([]);
  });

  it("el detector ve el cuarto argumento y no cuenta comentarios", () => {
    expect(clientesDelGate(`// requierePermiso(a, b, "x", tx)\nawait requierePermiso(a, b, "x", tx); await requierePermiso(a, b, "x", actor.db); requierePermiso(a, b, "x");`)).toEqual(["tx", "actor.db", "(sin cliente)"]);
  });
});
