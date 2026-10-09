import { describe, expect, it } from "vitest";
import { analizarFuente } from "./guardas/analizador";

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
