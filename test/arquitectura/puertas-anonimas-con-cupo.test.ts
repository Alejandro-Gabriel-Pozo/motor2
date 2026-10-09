import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Las puertas ANÓNIMAS de la app llevan cupo por origen ANTES de tocar la base (S-27, T11 del endurecimiento; guard GT-8, parte de la app; la de la consola, en
 * `consola-cupo-de-codigos.test.ts`). El comportamiento lo prueba `test/auth/abrir-invitacion-con-cupo-por-origen.test.ts`; esto fija la FORMA:
 *  - `abrirInvitacion` (la única Server Action de la app que se puede invocar sin sesión) consulta el cupo del origen DESPUÉS de descartar el token mal formado (no cuesta nada ni
 *    cuenta) y ANTES de `invitacionDelToken` (la consulta a la base compartida);
 *  - las otras dos acciones del archivo (`aceptarMiInvitacion*`) NIEGAN al anónimo: lo primero que hacen es pedir la sesión. Si alguna dejara de hacerlo sería una puerta
 *    anónima más y tendría que entrar acá con su propio cupo.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el cupo; ponerlo después de `invitacionDelToken`; ponerlo antes de la forma del token; una acción de aceptar que no pide la sesión primero.
 */
const RUTA = "src/server/actions/auth/invitacion.ts";
const fuente = ts.createSourceFile(RUTA, readFileSync(join(__dirname, "../..", RUTA), "utf8"), ts.ScriptTarget.Latest, true);

const funcion = (nombre: string): ts.FunctionDeclaration => {
  const f = fuente.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre);
  if (!f?.body) throw new Error(`No encuentro ${nombre} en ${RUTA}`);
  return f;
};

/** Posición (en el texto) de cada llamada a `nombre` dentro de `nodo`. */
function posicionesDeLlamadas(nodo: ts.Node, nombre: string): number[] {
  const salida: number[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) salida.push(n.getStart(fuente));
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return salida;
}

describe("GT-8 — las puertas anónimas de la app llevan cupo por origen antes de la base", () => {
  const abrir = funcion("abrirInvitacion");

  it("sanidad: encuentra las llamadas que ordena", () => {
    expect(posicionesDeLlamadas(abrir, "esTokenConFormaValida")).toHaveLength(1);
    expect(posicionesDeLlamadas(abrir, "invitacionDelToken")).toHaveLength(1);
  });

  it("abrirInvitacion: forma del token → cupo del origen → consulta a la base, en ese orden", () => {
    const forma = posicionesDeLlamadas(abrir, "esTokenConFormaValida")[0]!;
    const cupo = posicionesDeLlamadas(abrir, "origenSinCupoParaAbrirInvitacion");
    const consulta = posicionesDeLlamadas(abrir, "invitacionDelToken")[0]!;
    expect(cupo, "tiene que consultar el cupo del origen una vez").toHaveLength(1);
    expect(cupo[0]!, "el cupo va después de la forma del token (un token mal formado no cuenta)").toBeGreaterThan(forma);
    expect(cupo[0]!, "el cupo va ANTES de la consulta a la base").toBeLessThan(consulta);
  });

  it("las acciones de aceptar niegan al anónimo: piden la sesión antes que cualquier otra cosa", () => {
    for (const nombre of ["aceptarMiInvitacion", "aceptarMiInvitacionDeUsuario"]) {
      const f = funcion(nombre);
      const sesion = posicionesDeLlamadas(f, "getUsuarioActual");
      expect(sesion, `${nombre} tiene que pedir la sesión`).toHaveLength(1);
      for (const otra of ["cookies", "aceptarInvitacionDeGerenteCasoDeUso", "aceptarInvitacionDeUsuarioCasoDeUso"]) {
        for (const posicion of posicionesDeLlamadas(f, otra)) expect(sesion[0]!, `${nombre}: la sesión va antes que ${otra}`).toBeLessThan(posicion);
      }
    }
  });

  it("el archivo no exporta más acciones que estas tres (una puerta nueva tiene que decidir su cupo acá)", () => {
    const exportadas = fuente.statements
      .filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      .map((s) => s.name!.text)
      .sort();
    expect(exportadas).toEqual(["aceptarMiInvitacion", "aceptarMiInvitacionDeUsuario", "abrirInvitacion"].sort());
  });
});
