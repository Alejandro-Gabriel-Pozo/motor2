import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Congelado de usuarios precargados: un usuario precargado (alta por email ANTES de que entre con Google) es uno más a migrar a invitaciones. Hasta E8 (ADR-024) había tres
 * lugares que creaban un `User` a mano; desde E8, `agregarOActualizarUsuario` y `crearSucursalConAdmin` ya NO precargan (invitan, o piden un miembro que ya existe) y el único
 * que queda es `crearEmpresa`, una fixture de pruebas que vive en `src/` (pendiente: mudarla a `test/setup`). Ninguno nuevo.
 */
const RAIZ = join(__dirname, "../../src");
const ESCRITURAS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

const PRECARGAN: Record<string, { cantidad: number; motivo: string }> = {
  "core/features/empresa/crear-empresa.ts": { cantidad: 1, motivo: "crearEmpresa precarga al primer admin por email (emailPrimerAdmin): fixture de pruebas, a mudar a test/setup." },
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Cantidad de `<algo>.user.create|createMany|upsert(...)` del fuente: las altas de `User` (los comentarios no cuentan: es AST). */
export function altasDeUser(fuente: string): number {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ESCRITURAS.has(nodo.expression.name.text)) {
      const objetivo = nodo.expression.expression;
      if (ts.isPropertyAccessExpression(objetivo) && objetivo.name.text === "user") n++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return n;
}

describe("usuarios precargados: no se crean más lugares que precarguen", () => {
  const encontrados = Object.fromEntries(
    archivos(RAIZ)
      .map((ruta) => [relative(RAIZ, ruta).split(sep).join("/"), altasDeUser(readFileSync(ruta, "utf8"))] as const)
      .filter(([, n]) => n > 0)
  );

  it("solo los lugares conocidos crean un User, con la cantidad declarada", () => {
    const esperados = Object.fromEntries(Object.entries(PRECARGAN).map(([archivo, e]) => [archivo, e.cantidad]));
    expect(encontrados, "Hay un lugar NUEVO que crea usuarios por email: pasalo por el flujo de invitaciones (o hablalo con el dueño) antes de agregarlo.").toEqual(esperados);
  });

  it("el detector cuenta lo que dice contar", () => {
    expect(altasDeUser(`await tx.user.upsert({ where: { email }, update: {}, create: { email } });`)).toBe(1);
    expect(altasDeUser(`await ctx.db.user.create({ data: {} }); await db.user.createMany({ data: [] });`)).toBe(2);
    expect(altasDeUser(`await db.user.findMany(); await db.userAccount.create({});`)).toBe(0);
    expect(altasDeUser(`// db.user.create({})`)).toBe(0);
  });
});
