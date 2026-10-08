import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Cada archivo de Server Actions (`"use server"` a nivel de archivo en `src/server/actions/`) está clasificado en EXACTAMENTE UNA lista:
 * migrado a caso de uso (`ACCIONES_CON_CASO_DE_USO`, protegido por `accion-migrada-sin-orquestacion`) o `ACCIONES_SIN_CASO_DE_USO`, con
 * el motivo por el que todavía no lo necesita. Falla cerrado: un archivo de acciones nuevo obliga a decidir en cuál va, en vez de nacer
 * con Prisma, transacción e idempotencia dentro de la acción sin que nadie lo haya elegido.
 */
const { ACCIONES_CON_CASO_DE_USO } = createRequire(__filename)("../../.dependency-cruiser-excepciones.cjs") as { ACCIONES_CON_CASO_DE_USO: { ruta: string }[] };

const SOLO_LECTURA = "solo lecturas: no hay escritura que orquestar (transacción, I3, auditoría).";
const SIN_CASO_DE_USO = "todavía sin caso de uso: `accion-migrada-sin-orquestacion` no le aplica. Candidata a migrar (y a sumarse a ACCIONES_CON_CASO_DE_USO) cuando gane transacción/I3/auditoría propias.";

const ACCIONES_SIN_CASO_DE_USO: Record<string, string> = {
  "auth/empresa-activa.ts": SIN_CASO_DE_USO,
  "auth/sucursal-activa.ts": SIN_CASO_DE_USO,
  "carta/copiar-carta.ts": SIN_CASO_DE_USO,
  "catalogo/proveedor-por-producto.ts": SIN_CASO_DE_USO,
  "catalogo/recetas.ts": "la escritura de la receta ya vive en casos-de-uso/guardar-version-de-receta.ts (lo exige escrituras-auditadas.test.ts); el resto son lecturas.",
  "movimientos/lecturas-conteo-fisico.ts": SOLO_LECTURA,
  "stock/lecturas-reclasificacion.ts": SOLO_LECTURA,
  "traspasos/lecturas.ts": SOLO_LECTURA,
};

const RAIZ = join(__dirname, "../../src/server/actions");

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

/** `"use server"` como directiva de archivo: una de las primeras sentencias, antes de cualquier otra cosa. */
function esArchivoDeAcciones(rel: string, codigo: string): boolean {
  const fuente = ts.createSourceFile(rel, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const s of fuente.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
    if (s.expression.text === "use server") return true;
  }
  return false;
}

const ARCHIVOS_DE_ACCIONES = archivos(RAIZ)
  .map((a) => relative(RAIZ, a).split(sep).join("/"))
  .filter((rel) => esArchivoDeAcciones(rel, readFileSync(join(RAIZ, rel), "utf8")));
const MIGRADAS = ACCIONES_CON_CASO_DE_USO.map((e) => e.ruta.replace("src/server/actions/", ""));

describe("los archivos de Server Actions están clasificados", () => {
  it("el descubrimiento ve archivos (sanidad: no pasa en vacío)", () => {
    expect(ARCHIVOS_DE_ACCIONES.length).toBeGreaterThan(30);
    expect(ARCHIVOS_DE_ACCIONES).toContain("movimientos/venta.ts");
  });

  it("cada archivo con \"use server\" figura en una (y solo una) de las dos listas", () => {
    const sinClasificar = ARCHIVOS_DE_ACCIONES.filter((a) => !MIGRADAS.includes(a) && !(a in ACCIONES_SIN_CASO_DE_USO));
    const enAmbas = MIGRADAS.filter((a) => a in ACCIONES_SIN_CASO_DE_USO);
    expect(sinClasificar, "archivo de acciones nuevo sin clasificar: migralo a un caso de uso (ACCIONES_CON_CASO_DE_USO en .dependency-cruiser-excepciones.cjs) o sumalo a ACCIONES_SIN_CASO_DE_USO con su motivo").toEqual([]);
    expect(enAmbas).toEqual([]);
  });

  it("ACCIONES_SIN_CASO_DE_USO no tiene restos (un archivo que ya no existe, ya no es de acciones o ya se migró) y cada entrada lleva motivo", () => {
    const restos = Object.keys(ACCIONES_SIN_CASO_DE_USO).filter((a) => !ARCHIVOS_DE_ACCIONES.includes(a));
    expect(restos).toEqual([]);
    expect(Object.entries(ACCIONES_SIN_CASO_DE_USO).filter(([, m]) => m.trim().length < 20)).toEqual([]);
  });
});
