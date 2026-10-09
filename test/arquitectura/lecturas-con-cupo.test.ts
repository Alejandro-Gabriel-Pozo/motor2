import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { REPORTES_PESADOS } from "../../src/server/actions/limitador-de-lecturas";

/**
 * Las lecturas llevan cupo por usuario (S-28, T11 del endurecimiento; GT-15 en su parte del limitador). El comportamiento lo prueba `test/seguridad/limitador-de-lecturas.test.ts`;
 * esto fija la FORMA, para que un arreglo «de prolijidad» no lo deshaga sin que nadie lo vea:
 *  - `requerirSesion` (el primer paso de TODO `requerirVer*`) cuenta la lectura con `lecturaSinCupo` DESPUÉS de resolver al usuario y ANTES de devolver el contexto: ninguna guarda
 *    de lectura lo esquiva;
 *  - cada reporte pesado (`REPORTES_PESADOS`) lo cuenta su página con `reportePesadoSinCupo(ctx.usuarioId, "<reporte>", …)` ANTES de pedirle los datos a su consulta, y no queda
 *    ningún reporte en la lista sin página ni página sin reporte.
 *
 * Mutaciones (cada una pone un caso en rojo): sacar el conteo de `requerirSesion`; ponerlo después de devolver; sacarlo de una página; ponerlo después de la consulta; un reporte
 * pesado nuevo en la lista sin su página.
 */
const RAIZ = join(__dirname, "../..");
const arbol = (ruta: string) => ts.createSourceFile(ruta, readFileSync(join(RAIZ, ruta), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function llamadas(nodo: ts.Node, fuente: ts.SourceFile, nombre: string): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === nombre) salida.push(n);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  void fuente;
  return salida;
}

describe("S-28 — requerirSesion cuenta toda lectura", () => {
  const ruta = "src/server/actions/con-sesion.ts";
  const fuente = arbol(ruta);
  const requerirSesion = fuente.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "requerirSesion");

  it("sanidad: encuentra la función", () => {
    expect(requerirSesion?.body).toBeDefined();
  });

  it("cuenta con `lecturaSinCupo(ctx.usuarioId, …)` después de obtener el contexto y antes de devolverlo", () => {
    const contexto = llamadas(requerirSesion!, fuente, "obtenerContextoUsuario");
    const cupo = llamadas(requerirSesion!, fuente, "lecturaSinCupo");
    expect(contexto, "resuelve al usuario").toHaveLength(1);
    expect(cupo, "cuenta la lectura una vez").toHaveLength(1);
    expect(cupo[0]!.arguments[0]?.getText(fuente), "por usuario").toBe("ctx.usuarioId");
    expect(cupo[0]!.pos, "después de resolver al usuario").toBeGreaterThan(contexto[0]!.pos);
    const retorno = requerirSesion!.body!.statements.find((s): s is ts.ReturnStatement => ts.isReturnStatement(s));
    expect(retorno, "devuelve el contexto").toBeDefined();
    expect(cupo[0]!.end, "antes de devolver el contexto").toBeLessThanOrEqual(retorno!.pos);
  });

  it("las guardas de lectura exportadas pasan por `requerirSesion` (directo o por `requerirSesionEnSucursal`)", () => {
    const exportadas = fuente.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    expect(exportadas.map((f) => f.name!.text).sort()).toEqual(["requerirVer", "requerirVerAlguna", "requerirVerAlgunaEnSucursal", "requerirVerDeEmpresa", "requerirVerEnSucursal"]);
    for (const f of exportadas) {
      const pasa = llamadas(f, fuente, "requerirSesion").length + llamadas(f, fuente, "requerirSesionEnSucursal").length;
      expect(pasa, `${f.name!.text} tiene que abrir con la sesión (y su cupo)`).toBe(1);
    }
  });
});

describe("S-28 — cada reporte pesado cuenta su pedido antes de consultar", () => {
  /** Reporte → su página y la consulta pesada a la que le pide los datos. */
  const PAGINAS: Record<(typeof REPORTES_PESADOS)[number], { pagina: string; consulta: string }> = {
    periodo: { pagina: "src/app/(app)/reportes/periodo/page.tsx", consulta: "obtenerReportePorPeriodo" },
    "rendimiento-recetas": { pagina: "src/app/(app)/reportes/rendimiento-recetas/page.tsx", consulta: "calcularRendimientoRecetas" },
    "resumen-consolidado": { pagina: "src/app/(app)/reportes/consolidado/page.tsx", consulta: "obtenerResumenConsolidado" },
  };

  it("hay una página para cada reporte pesado y ninguna de más", () => {
    expect(Object.keys(PAGINAS).sort()).toEqual([...REPORTES_PESADOS].sort());
  });

  for (const [reporte, { pagina, consulta }] of Object.entries(PAGINAS)) {
    it(`${reporte}: \`reportePesadoSinCupo(ctx.usuarioId, "${reporte}", …)\` va antes de ${consulta}`, () => {
      const fuente = arbol(pagina);
      const cupos = llamadas(fuente, fuente, "reportePesadoSinCupo");
      expect(cupos, "una sola cuenta por página").toHaveLength(1);
      expect(cupos[0]!.arguments[0]?.getText(fuente)).toBe("ctx.usuarioId");
      expect(cupos[0]!.arguments[1]?.getText(fuente), "la clave del reporte, literal").toBe(JSON.stringify(reporte));
      const consultas = llamadas(fuente, fuente, consulta);
      expect(consultas, "la consulta pesada").toHaveLength(1);
      expect(cupos[0]!.end, "se cuenta ANTES de consultar").toBeLessThanOrEqual(consultas[0]!.pos);
    });
  }
});
