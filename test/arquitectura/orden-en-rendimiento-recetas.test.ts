import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * D.3 (docs/pureza-integracion.md): el reporte de rendimiento de recetas no puede depender del orden en que Postgres entrega las filas (sin `ORDER BY`, la
 * base no promete ninguno y el plan puede cambiarlo de un día para otro). Toda lectura que devuelve filas en `server/consultas/reportes/rendimiento-recetas.ts`
 * —`findMany`, `findFirst` y `groupBy` sobre `db.<modelo>`— lleva su `orderBy` en el objeto de argumentos; una lectura nueva sin él pone este test en rojo.
 * Las lecturas que el archivo delega (`cargarRecetasVigentes`, `obtenerCostoActualPorMP`, `cargarClasificacionNoComestibles`) viven en otros archivos.
 */
const ARCHIVO = join(__dirname, "../../src/server/consultas/reportes/rendimiento-recetas.ts");

/** Las operaciones de Prisma que devuelven filas en un orden (las que lo necesitan explícito). */
const LECTURAS_CON_ORDEN = new Set(["findMany", "findFirst", "findFirstOrThrow", "groupBy"]);

interface Lectura {
  texto: string;
  conOrden: boolean;
}

/** Las lecturas `db.<modelo>.<operación>(...)` del fuente y si su primer argumento (un objeto literal) trae `orderBy`. También cuenta `$queryRaw` sin ORDER BY. */
function lecturasDe(codigo: string): Lectura[] {
  const fuente = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lecturas: Lectura[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LECTURAS_CON_ORDEN.has(n.expression.name.text)) {
      const sobre = n.expression.expression;
      if (ts.isPropertyAccessExpression(sobre) && ts.isIdentifier(sobre.expression) && sobre.expression.text === "db") {
        const args = n.arguments[0];
        const conOrden =
          !!args &&
          ts.isObjectLiteralExpression(args) &&
          args.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name) && p.name.text === "orderBy");
        lecturas.push({ texto: `${sobre.getText(fuente)}.${n.expression.name.text} (línea ${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1})`, conOrden });
      }
    }
    if (ts.isTaggedTemplateExpression(n) && /\$queryRaw/.test(n.tag.getText(fuente))) {
      lecturas.push({ texto: `$queryRaw (línea ${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1})`, conOrden: /ORDER\s+BY/i.test(n.template.getText(fuente)) });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return lecturas;
}

describe("rendimiento de recetas: toda lectura lleva su orden explícito (D.3)", () => {
  it("el analizador distingue una lectura con orderBy de una sin él (sanidad: no pasa en vacío)", () => {
    const lecturas = lecturasDe(
      [
        "const a = await db.producto.findMany({ where: {}, orderBy: { id: 'asc' } });",
        "const b = await db.movimientoStock.groupBy({ by: ['productoId'], _sum: { cantidad: true } });",
        "const c = await db.conteoFisico.findFirst();",
        "const d = await db.producto.count({ where: {} });",
        "const e = await otro.producto.findMany({});",
        "const f = await db.$queryRaw`SELECT 1 FROM x`;",
      ].join("\n")
    );
    expect(lecturas.map((l) => [l.texto.replace(/ \(línea \d+\)/, ""), l.conOrden])).toEqual([
      ["db.producto.findMany", true],
      ["db.movimientoStock.groupBy", false],
      ["db.conteoFisico.findFirst", false],
      ["$queryRaw", false],
    ]);
  });

  it("todas las lecturas de rendimiento-recetas.ts tienen orderBy", () => {
    const lecturas = lecturasDe(readFileSync(ARCHIVO, "utf8"));
    // 11 hoy (2 groupBy de apertura/cierre, conteos, groupBy y movimientos de las anclas, entradas, ventas, los 2 de los tramos y los 2 de productos).
    expect(lecturas.length, "no encontró ninguna lectura: ¿cambió la forma de llamar a la base?").toBeGreaterThanOrEqual(11);
    const sinOrden = lecturas.filter((l) => !l.conOrden).map((l) => l.texto);
    expect(sinOrden, `lecturas sin orderBy en rendimiento-recetas.ts (D.3: el resultado no puede depender del orden de la base):\n${sinOrden.join("\n")}`).toEqual([]);
  });
});
