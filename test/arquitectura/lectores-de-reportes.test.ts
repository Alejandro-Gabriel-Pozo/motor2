import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Los lectores de VARIAS sucursales (reciben `sucursales` como primer parámetro y juntan datos de todas) no filtran por permiso: confían
 * en que quien los llama les pase solo las sucursales donde el rol puede ver la acción. Por eso toda pantalla/acción que llame a uno
 * tiene que armar esa lista con `sucursalesVisiblesPara` (no con `ctx.membresias` a secas ni con una consulta de todas las sucursales de
 * la empresa). `membresias-filtradas.test.ts` cubre quien lee `.membresias`; esta prueba cubre el otro hueco: un lector multi-sucursal
 * llamado con una lista que viene de otro lado. Falla cerrado también ante un lector NUEVO: obliga a sumarlo a LECTORES.
 */
const RAIZ = join(__dirname, "../../src");
const HELPER = "sucursalesVisiblesPara";

/** Lector multi-sucursal → motivo. Si agregás uno (primer parámetro `sucursales`), va acá. */
const LECTORES: Record<string, string> = {
  obtenerResumenConsolidado: "core/reportes/resumen-consolidado.ts: un resumen operativo por sucursal recibida",
  compararRendimientosPorSucursal: "core/reportes/rendimiento-por-sucursal.ts: una columna de rendimiento calibrado por sucursal recibida",
  compararRendimientosDeSucursales: "server/consultas/reportes/rendimiento-por-sucursal.ts: capa de consulta sobre el anterior (la UI no importa core con Prisma)",
};

const CARPETAS_DE_LECTORES = ["core/reportes", "server/consultas"];
const CARPETAS_DE_LLAMADORES = ["app", "components", "server/actions"];

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

const fuenteDe = (codigo: string) => ts.createSourceFile("x.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Funciones exportadas cuyo PRIMER parámetro se llama `sucursales`. */
export function lectoresMultiSucursal(codigo: string): string[] {
  const nombres: string[] = [];
  for (const s of fuenteDe(codigo).statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const primero = s.parameters[0]?.name;
      if (primero && ts.isIdentifier(primero) && primero.text === "sucursales") nombres.push(s.name.text);
    }
  }
  return nombres;
}

/** Funciones que el fuente llama por nombre (identificador suelto). */
export function llamadasA(codigo: string): Set<string> {
  const llamadas = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) llamadas.add(n.expression.text);
    ts.forEachChild(n, visitar);
  };
  visitar(fuenteDe(codigo));
  return llamadas;
}

describe("lectores de varias sucursales: quien los llama filtra por permiso", () => {
  const rel = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  it("el analizador reconoce un lector y una llamada (sanidad: no pasa en vacío)", () => {
    expect(lectoresMultiSucursal("export async function f(sucursales: X[], db: Db) {}\nexport function g(id: string) {}")).toEqual(["f"]);
    expect(lectoresMultiSucursal("async function f(sucursales: X[]) {}")).toEqual([]);
    expect([...llamadasA("const a = await f(x); g.h(y);")]).toEqual(["f"]);
  });

  it("LECTORES coincide con las funciones exportadas de core/reportes y server/consultas con primer parámetro `sucursales`", () => {
    const encontrados = CARPETAS_DE_LECTORES.flatMap((c) => archivos(join(RAIZ, c))).flatMap((ruta) => lectoresMultiSucursal(readFileSync(ruta, "utf8")));
    const sinListar = encontrados.filter((n) => !(n in LECTORES));
    const fantasmas = Object.keys(LECTORES).filter((n) => !encontrados.includes(n));
    expect(sinListar, "lector multi-sucursal nuevo: sumalo a LECTORES (y filtrá a quien lo llame con sucursalesVisiblesPara)").toEqual([]);
    expect(fantasmas, "LECTORES nombra una función que ya no existe o ya no recibe `sucursales`").toEqual([]);
  });

  it("todo archivo de app/components/server/actions que llama a un lector usa `sucursalesVisiblesPara`", () => {
    const problemas: string[] = [];
    let llamadores = 0;
    for (const ruta of CARPETAS_DE_LLAMADORES.flatMap((c) => archivos(join(RAIZ, c)))) {
      const llamadas = llamadasA(readFileSync(ruta, "utf8"));
      if (!Object.keys(LECTORES).some((l) => llamadas.has(l))) continue;
      llamadores++;
      if (!llamadas.has(HELPER)) problemas.push(rel(ruta));
    }
    expect(llamadores, "ninguna pantalla llama a un lector: ¿cambió el nombre?").toBeGreaterThanOrEqual(2);
    expect(problemas, `llaman a un lector multi-sucursal sin armar la lista con ${HELPER}(ctx, accion):\n${problemas.join("\n")}`).toEqual([]);
  });
});
