import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * E8 (ADR-024): el enlace automático de cuentas de Google por email (`allowDangerousEmailAccountLinking`) está APAGADO y no vuelve. Con él encendido, quien controla una cuenta de
 * Google con el email de un usuario precargado entra como ese usuario sin que nadie lo haya invitado. La vinculación la hace `decidirInicioDeSesion` con una invitación.
 * El detector mira el AST (un comentario que nombre la opción no cuenta) y rechaza la opción con cualquier valor: ni `true` ni una variable.
 */
const RAIZ = join(__dirname, "../..");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (n === "node_modules" || n === ".next") return [];
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

/** Cantidad de propiedades llamadas `allowDangerousEmailAccountLinking` del fuente (asignaciones o abreviadas). */
export function usosDelEnlaceAutomatico(fuente: string): number {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  let n = 0;
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isPropertyAssignment(nodo) || ts.isShorthandPropertyAssignment(nodo)) && nodo.name.getText(sf) === "allowDangerousEmailAccountLinking") n++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return n;
}

describe("sin enlace automático de cuentas por email", () => {
  it("ningún archivo de src/ ni de la consola configura allowDangerousEmailAccountLinking", () => {
    const encontrados = [...archivos(join(RAIZ, "src")), ...archivos(join(RAIZ, "plataforma/src"))]
      .filter((ruta) => usosDelEnlaceAutomatico(readFileSync(ruta, "utf8")) > 0)
      .map((ruta) => relative(RAIZ, ruta).split(sep).join("/"));
    expect(encontrados, "Se volvió a encender el enlace automático de cuentas: ver ADR-024 (la vinculación es por invitación).").toEqual([]);
  });

  it("el proveedor de Google de auth.ts se declara sin opciones de enlace", () => {
    const fuente = readFileSync(join(RAIZ, "src/lib/auth.ts"), "utf8");
    expect(fuente).toMatch(/providers:\s*\[[^\]]*\bGoogle\b[^\]]*\]/);
    expect(fuente).toContain("decidirInicioDeSesion");
  });

  it("el detector cuenta lo que dice contar", () => {
    expect(usosDelEnlaceAutomatico(`Google({ allowDangerousEmailAccountLinking: true })`)).toBe(1);
    expect(usosDelEnlaceAutomatico(`const allowDangerousEmailAccountLinking = false; Google({ allowDangerousEmailAccountLinking })`)).toBe(1);
    expect(usosDelEnlaceAutomatico(`Google({ allowDangerousEmailAccountLinking: process.env.X === "1" })`)).toBe(1);
    expect(usosDelEnlaceAutomatico(`// allowDangerousEmailAccountLinking: true\nGoogle`)).toBe(0);
    expect(usosDelEnlaceAutomatico(`const t = "allowDangerousEmailAccountLinking"; Google({ clientId: t })`)).toBe(0);
  });
});
