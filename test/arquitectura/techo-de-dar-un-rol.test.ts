import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guardián del contrato C2 del RBAC (O.35; Hito 3, Fase II, II.2 de `docs/plan-hito-3-pureza.md`): dar un rol a alguien pasa por UNA función de
 * `core/permisos/gestion-de-usuarios.ts`, `mensajeSiNoPuedeDarRolA(actor, rol, objetivo)`, que junta los dos techos en su orden (el del rol y el de gestión sobre
 * quien lo recibe). Antes esa composición estaba copiada a mano en tres lugares; copiada, se puede invertir el orden de los mensajes o perder una mitad.
 *
 *  1. Fuera de `core/permisos` nadie usa la MEDIA regla `mensajeSiNoPuedeAsignarRol` (ni importada, ni con alias, ni por un espacio de nombres).
 *  2. La variante sin el techo de gestión, `mensajeSiNoPuedeDarRolSinTechoDeGestion`, la usan solo los archivos de la lista cerrada de abajo, cada uno con su
 *     motivo (y cada uno la usa de verdad: una entrada que ya no hace falta se borra).
 *
 * `mensajeSiNoPuedeGestionar` sola sigue siendo pública: es el techo de los flujos que TOCAN a una persona sin darle un rol (activarla o desactivarla en una
 * sucursal, sus notas, su cuenta en la empresa, invitarla a vincular Google, una invitación de vinculación pendiente). Sin rol que dar, no hay media regla que
 * olvidar. Aproximación estática por AST: los comentarios y los textos no cuentan.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETA_DE_LA_REGLA = "core/permisos/";
const MEDIA_REGLA = "mensajeSiNoPuedeAsignarRol";
const VARIANTE = "mensajeSiNoPuedeDarRolSinTechoDeGestion";

/** Archivo (relativo a `src/`) → motivo. Lista CERRADA de quién da un rol sin medir a quien lo recibe. */
const USAN_LA_VARIANTE: Record<string, string> = {
  "server/actions/auth/casos-de-uso/crear-sucursal-con-admin.ts":
    "Contrato C6 (I.4b): el alta de una sucursal nombra a su primer admin con el techo del rol y SIN el de gestión sobre el nombrado, porque un administrador tiene que poder nombrar al gerente (lo fija techo-en-el-alta-de-sucursal.test.ts).",
  "server/actions/auth/casos-de-uso/invitacion-gestionable.ts":
    "Revocar o reenviar una invitación de USUARIO pendiente exige poder dar cada rol que ofrece; la persona todavía no es miembro de la empresa: no hay a quién medir con el techo de gestión.",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Las líneas donde el fuente usa alguno de `nombres`: un import (por su nombre original, aunque lleve alias) o un acceso `x.nombre` (espacio de nombres). */
export function usosDe(fuente: string, nombres: ReadonlySet<string>): { nombre: string; linea: number }[] {
  const sf = ts.createSourceFile("x.tsx", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const usos: { nombre: string; linea: number }[] = [];
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isImportSpecifier(nodo)) {
      const original = (nodo.propertyName ?? nodo.name).text;
      if (nombres.has(original)) usos.push({ nombre: original, linea: linea(nodo) });
    }
    if (ts.isPropertyAccessExpression(nodo) && nombres.has(nodo.name.text)) usos.push({ nombre: nodo.name.text, linea: linea(nodo) });
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return usos;
}

const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");
const fuera = archivos(RAIZ).filter((r) => !nombreDe(r).startsWith(CARPETA_DE_LA_REGLA));

describe("dar un rol pasa por mensajeSiNoPuedeDarRolA (C2)", () => {
  it("encuentra archivos de src/", () => {
    expect(fuera.length).toBeGreaterThan(200);
  });

  it("fuera de core/permisos nadie usa la media regla mensajeSiNoPuedeAsignarRol", () => {
    const problemas = fuera.flatMap((ruta) =>
      usosDe(readFileSync(ruta, "utf8"), new Set([MEDIA_REGLA])).map(
        (u) => `${nombreDe(ruta)}:${u.linea} usa \`${MEDIA_REGLA}\` sola: para dar un rol a alguien, \`mensajeSiNoPuedeDarRolA(actor, rol, objetivo)\` (los dos techos, en su orden)`,
      ),
    );
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("la variante sin techo de gestión la usan solo los archivos declarados, y todos los declarados la usan", () => {
    const usan = fuera.filter((ruta) => usosDe(readFileSync(ruta, "utf8"), new Set([VARIANTE])).length > 0).map(nombreDe).sort();
    const sinDeclarar = usan.filter((n) => !(n in USAN_LA_VARIANTE));
    expect(sinDeclarar, `Dan un rol sin medir a quien lo recibe y no están en USAN_LA_VARIANTE (con su motivo):\n${sinDeclarar.join("\n")}`).toEqual([]);
    expect(usan).toEqual(Object.keys(USAN_LA_VARIANTE).sort());
    for (const nombre of Object.keys(USAN_LA_VARIANTE)) expect(existsSync(join(RAIZ, nombre)), `${nombre} no existe: sacalo de la lista`).toBe(true);
  });

  it("el detector ve el import, el alias y el espacio de nombres, y no los comentarios ni los textos", () => {
    const media = new Set([MEDIA_REGLA]);
    expect(usosDe(`import { mensajeSiNoPuedeAsignarRol } from "@/core/permisos/gestion-de-usuarios";`, media)).toHaveLength(1);
    expect(usosDe(`import { mensajeSiNoPuedeAsignarRol as techo } from "@/core/permisos/gestion-de-usuarios";`, media)).toHaveLength(1);
    expect(usosDe(`import * as g from "@/core/permisos/gestion-de-usuarios";\nconst r = g.mensajeSiNoPuedeAsignarRol(a, b);`, media)).toEqual([{ nombre: MEDIA_REGLA, linea: 2 }]);
    expect(usosDe(`// mensajeSiNoPuedeAsignarRol(a, b)\nconst t = "mensajeSiNoPuedeAsignarRol";`, media)).toEqual([]);
    expect(usosDe(`import { mensajeSiNoPuedeDarRolA } from "@/core/permisos/gestion-de-usuarios";`, media)).toEqual([]);
  });
});
