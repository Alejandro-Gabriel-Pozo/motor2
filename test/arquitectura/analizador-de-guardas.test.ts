import { describe, expect, it } from "vitest";
import { analizarFuente, esArchivoUseServer, tieneUseServer } from "./guardas/analizador";

/**
 * Tests del analizador mismo (no del repo real): fuentes en memoria, cada
 * una aislando un falso negativo/positivo concreto que el enfoque por regex
 * de `acciones-con-guarda.test.ts` tenía (ver el plan de este pendiente).
 * Sirven para poder auditar el analizador sin tocar `src/`.
 */

function estadoDe(fuente: string, nombre: string) {
  const resultado = analizarFuente("fixture.ts", fuente);
  const f = resultado.funciones.find((f) => f.nombre === nombre);
  if (!f) throw new Error(`No se encontró la función "${nombre}" en el análisis`);
  return f.estado;
}

describe("analizarFuente: detección de archivo de acciones", () => {
  it("reconoce 'use server' como primera sentencia", () => {
    expect(analizarFuente("f.ts", `"use server";\nexport async function foo() {}`).esArchivoDeAcciones).toBe(true);
  });

  it("sigue reconociendo 'use server' aunque haya un comentario/banner antes (la regex vieja lo perdía)", () => {
    const fuente = `/**\n * Banner con muchas líneas.\n */\n"use server";\nexport async function foo() {}`;
    expect(analizarFuente("f.ts", fuente).esArchivoDeAcciones).toBe(true);
  });

  it("un archivo sin 'use server' no se marca como archivo de acciones", () => {
    expect(analizarFuente("f.ts", `export async function foo() {}`).esArchivoDeAcciones).toBe(false);
  });
});

describe("analizarFuente: falsos negativos que la regex vieja tenía y el AST no", () => {
  it("una guarda mencionada solo en un COMENTARIO no cuenta como guarda", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      // antes usaba conPermiso("gestion_permisos") acá
      export async function crearRol() {
        return { ok: true };
      }
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("sin-guarda");
  });

  it("una guarda mencionada dentro de un STRING no cuenta como guarda", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      export async function crearRol() {
        return error("Falta conPermiso(\\"gestion_permisos\\", ...)");
      }
      function error(m: string) { return { ok: false, mensaje: m }; }
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("sin-guarda");
  });

  it("una guarda llamada SIN await, con el resultado descartado, se marca 'guarda-descartada'", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      export async function crearRol() {
        conPermiso("gestion_permisos", async () => ({ ok: true }));
        return { ok: true };
      }
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("guarda-descartada");
  });

  it("una guarda de lectura llamada con await pero sin capturar el resultado SÍ cuenta (patrón real de requerirVer)", () => {
    const fuente = `
      "use server";
      import { requerirVer } from "../con-sesion";
      export async function listarRoles() {
        await requerirVer("gestion_permisos");
        return [];
      }
    `;
    expect(estadoDe(fuente, "listarRoles")).toBe("ok");
  });

  it("una función exportada como ARROW FUNCTION (export const) se detecta igual que 'export async function' (la regex vieja la ignoraba por completo)", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      export const crearRol = async () => {
        return conPermiso("gestion_permisos", async () => ({ ok: true }));
      };
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("ok");
  });

  it("una arrow function exportada SIN guarda se detecta como 'sin-guarda' (antes era invisible)", () => {
    const fuente = `
      "use server";
      export const crearRol = async () => {
        return { ok: true };
      };
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("sin-guarda");
  });

  it("una guarda dentro de código muerto (if(false)) no cuenta como guarda de la función", () => {
    const fuente = `
      "use server";
      import { requerirVer } from "../con-sesion";
      export async function crearRol() {
        if (false) { await requerirVer("gestion_roles"); }
        return { ok: true };
      }
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("sin-guarda");
  });

  it("una guarda que llega DESPUÉS de una lectura a la base se marca 'guarda-tardia'", () => {
    const fuente = `
      "use server";
      import { prisma } from "@/lib/db";
      import { requerirVer } from "../con-sesion";
      export async function listarRoles() {
        const filas = await prisma.rol.findMany();
        await requerirVer("gestion_permisos");
        return filas;
      }
    `;
    expect(estadoDe(fuente, "listarRoles")).toBe("guarda-tardia");
  });

  it("leer `await headers()` o `await cookies()` antes de la guarda NO la vuelve tardía (S-27: el cupo por origen de una puerta anónima); cualquier otro await, sí", () => {
    const conMetadatos = `
      "use server";
      import { headers } from "next/headers";
      import { invitacionDelToken } from "@/server/sesion/invitacion";
      export async function abrir(token: string) {
        const origen = (await headers()).get("x-forwarded-for");
        if (origen === "x") return null;
        const vista = await invitacionDelToken(token, new Date());
        return vista;
      }
    `;
    expect(estadoDe(conMetadatos, "abrir")).toBe("ok");
    const conOtroAwait = conMetadatos.replace('(await headers()).get("x-forwarded-for")', '(await otraCosa()).get("x-forwarded-for")');
    expect(estadoDe(conOtroAwait, "abrir")).toBe("guarda-tardia");
  });

  it("una guarda importada con ALIAS se resuelve igual (por nombre local, no por el nombre importado)", () => {
    const fuente = `
      "use server";
      import { conPermiso as gate } from "../con-permiso";
      export async function crearRol() {
        return gate("gestion_permisos", async () => ({ ok: true }));
      }
    `;
    expect(estadoDe(fuente, "crearRol")).toBe("ok");
  });

  it("delegación transitiva: una función que delega en OTRA función exportada del mismo archivo que sí está guardada, cuenta como guardada (patrón guardarReceta/obtenerRecetaVigente)", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      export async function guardarReceta(id: string) {
        return conPermiso("guardar_receta", async () => ({ ok: true }));
      }
      export async function agregarIngredienteAReceta(id: string) {
        return guardarReceta(id);
      }
    `;
    expect(estadoDe(fuente, "agregarIngredienteAReceta")).toBe("ok");
  });

  it("delegación transitiva: si la función delegada NO está guardada, la que delega tampoco lo está", () => {
    const fuente = `
      "use server";
      export async function guardarRecetaSinGuarda(id: string) {
        return { ok: true };
      }
      export async function agregarIngredienteAReceta(id: string) {
        return guardarRecetaSinGuarda(id);
      }
    `;
    expect(estadoDe(fuente, "agregarIngredienteAReceta")).toBe("sin-guarda");
  });

  it("una forma de export no reconocida (re-export desde otro módulo) nunca se saltea en silencio", () => {
    const fuente = `
      "use server";
      export { crearRol } from "./roles-internas";
    `;
    const resultado = analizarFuente("f.ts", fuente);
    expect(resultado.funciones.some((f) => f.estado === "export-no-reconocido")).toBe(true);
  });
});

describe("analizarFuente: falsos positivos que la regex vieja tenía y el AST no", () => {
  it("un genérico anidado (conPermiso<Awaited<X>>(...)) no rompe la detección", () => {
    const fuente = `
      "use server";
      import { conPermiso } from "../con-permiso";
      type ResultadoConId = { ok: true; id: string };
      export async function crearInsumo() {
        return conPermiso<Awaited<ResultadoConId>>("alta_producto", async () => ({ ok: true, id: "1" }));
      }
    `;
    expect(estadoDe(fuente, "crearInsumo")).toBe("ok");
  });
});

describe("analizarFuente: qué guarda abre cada función (lista cerrada de guardas a mano, pre-paso P de la Fase I-B)", () => {
  it("informa el nombre IMPORTADO de la guarda (aunque tenga alias), también por delegación, y nada si no quedó ok", () => {
    const fuente = `
      "use server";
      import { obtenerContextoUsuario as contexto } from "@/core/auth/contexto";
      import { requerirVer } from "../con-sesion";
      export async function aMano() { const ctx = await contexto(); return ctx; }
      export async function conVer() { const ctx = await requerirVer("precio_local"); return ctx; }
      export async function delegada() { return aMano(); }
      export async function sinGuarda() { return 1; }
    `;
    const porNombre = Object.fromEntries(analizarFuente("f.ts", fuente).funciones.map((f) => [f.nombre, f.guarda]));
    expect(porNombre).toEqual({ aMano: "obtenerContextoUsuario", conVer: "requerirVer", delegada: "obtenerContextoUsuario", sinGuarda: undefined });
  });
});

/**
 * I-2 de la auditoría final: `export const x = <expresión que no es una función literal>` en un archivo "use server" se ignoraba como «constante de datos». Un envoltorio
 * (`export const borrar = conRegistro(async (id) => …)`) o una función con `as` quedaba fuera de TODOS los inventarios de acciones: una puerta HTTP sin `conPermiso` que ningún guard
 * veía. Ahora toda exportación que no sea CLARAMENTE una constante de datos es una acción a inventariar, o `export-no-reconocido`.
 */
describe("analizarFuente: exportaciones `export const` que no son una función literal (I-2)", () => {
  const CABECERA = `"use server";\nimport { conPermiso } from "../con-permiso";\n`;

  it("ataque: un ENVOLTORIO sin conPermiso (conRegistro(async …)) es una acción SIN guarda, no una constante ignorada", () => {
    const fuente = `${CABECERA}export const borrar = conRegistro(async (id: string) => { await prisma.cosa.delete({ where: { id } }); });`;
    expect(estadoDe(fuente, "borrar")).toBe("sin-guarda");
  });

  it("ataque: una función con `as` / paréntesis / satisfies / `!` también se inventaría (y sin guarda queda roja)", () => {
    for (const envoltura of ["(async () => 1) as Accion", "((async () => 1))", "(async () => 1) satisfies Accion", "((async () => 1) as Accion)!"]) {
      expect(estadoDe(`${CABECERA}export const a = ${envoltura};`, "a"), envoltura).toBe("sin-guarda");
    }
  });

  it("ataque: una forma que no se puede resolver (alias, condicional, destructuring) es export-no-reconocido", () => {
    expect(estadoDe(`${CABECERA}const f = async () => 1;\nexport const alias = f;`, "alias")).toBe("export-no-reconocido");
    expect(estadoDe(`${CABECERA}export const c = hay ? async () => 1 : async () => 2;`, "c")).toBe("export-no-reconocido");
    expect(estadoDe(`${CABECERA}export const { a, b } = acciones;`, "*")).toBe("export-no-reconocido");
    expect(estadoDe(`${CABECERA}export const datos = { borrar: async () => 1 };`, "datos")).toBe("export-no-reconocido");
  });

  it("control: el envoltorio que ES una guarda reconocida (o la lleva adentro) queda ok, con su guarda", () => {
    const directa = analizarFuente("f.ts", `${CABECERA}export const crear = conPermiso("alta", async () => 1);`).funciones.find((f) => f.nombre === "crear");
    expect(directa).toMatchObject({ estado: "ok", guarda: "conPermiso" });
    const anidada = analizarFuente("f.ts", `${CABECERA}export const crear = conRegistro(conPermiso("alta", async () => 1));`).funciones.find((f) => f.nombre === "crear");
    expect(anidada).toMatchObject({ estado: "ok", guarda: "conPermiso" });
    const porDentro = `${CABECERA}export const crear = conRegistro(async () => { return conPermiso("alta", async () => 1); });`;
    expect(estadoDe(porDentro, "crear")).toBe("ok");
  });

  it("control: una constante de datos clara en un archivo 'use server' no se marca (literal, objeto, arreglo, new Set)", () => {
    const fuente = `${CABECERA}export const A = 1;\nexport const B = "x";\nexport const C = { a: 1 };\nexport const D = [1, 2] as const;\nexport const E = new Set(["a"]);\nexport const F = -1;\nexport async function accion() { return conPermiso("k", async () => 1); }`;
    const nombres = analizarFuente("f.ts", fuente).funciones.map((f) => f.nombre);
    expect(nombres).toEqual(["accion"]);
  });

  it("fuera de un archivo 'use server' un `export const` que no es una función no se inventaría", () => {
    expect(analizarFuente("f.ts", `export const alias = f;\nexport const w = conRegistro(async () => 1);`).funciones).toEqual([]);
  });
});

describe("esArchivoUseServer / tieneUseServer: el prólogo se lee por AST, no por regex (I-2)", () => {
  it("ataque: un comentario o un banner antes de la directiva no saca al archivo del alcance", () => {
    expect(esArchivoUseServer(`/* nota */\n"use server";\nexport async function a() {}`)).toBe(true);
    expect(esArchivoUseServer(`// nota\n'use server'\nexport async function a() {}`)).toBe(true);
    expect(esArchivoUseServer(`"use strict";\n"use server";\nexport async function a() {}`)).toBe(true);
  });

  it("control: lo que NO es la directiva del archivo no cuenta", () => {
    expect(esArchivoUseServer(`export async function a() {}`)).toBe(false);
    expect(esArchivoUseServer(`const x = "use server";\nexport async function a() {}`)).toBe(false);
    expect(esArchivoUseServer(`export function a() { "use server"; }`)).toBe(false);
  });

  it("tieneUseServer también ve la Server Action EN LÍNEA de una función", () => {
    expect(tieneUseServer(`export default function P() { async function f() { "use server"; await borrar(); } return f; }`)).toBe(true);
    expect(tieneUseServer(`export default function P() { return 1; }`)).toBe(false);
  });
});
