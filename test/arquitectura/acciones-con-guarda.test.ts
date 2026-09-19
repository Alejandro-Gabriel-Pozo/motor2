import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: toda función que exporta un archivo `"use server"` es un endpoint que se puede invocar
 * directo, sin pasar por la página que la usa. Por eso cada una tiene que abrir con una guarda de acceso. Este test
 * recorre `src/server/actions` y falla si aparece una función exportada sin ninguna de las guardas reconocidas:
 *
 * - `conPermiso(...)`: mutaciones, con permiso de Editar (ver con-permiso.ts).
 * - `requerirSesion()` / `requerirSesionEnSucursal(id)`: lecturas, con sesión y membresía (ver con-sesion.ts).
 * - `requerirVer(clave)` / `requerirVerEnSucursal(id, clave)`: lecturas de los datos propios de una pantalla: además, su permiso de Ver.
 * - `getUsuarioActual()` / `obtenerContextoUsuario()` / `requierePermiso*(...)` puestos a mano: casos puntuales.
 *
 * Es una comprobación por texto (no ejecuta nada): atrapa el olvido, no una guarda mal usada. Una función que de
 * verdad no debe llevar guarda (por ejemplo, un ayudante interno) va en un archivo SIN `"use server"`, no acá.
 */
const RAIZ = join(__dirname, "../../src/server/actions");
// `guardarReceta(` cuenta como guarda: las acciones de la ficha de receta (agregar/quitar ingrediente o paso, cabecera) no
// llevan `conPermiso` propio, delegan en `guardarReceta`, que abre con `conPermiso("guardar_receta")`.
const GUARDAS = /conPermiso\w*\s*(<[^>(]*>)?\(|requerirSesion(EnSucursal)?\(|requerirVer(EnSucursal)?\(|obtenerContextoUsuario\(|getUsuarioActual\(|requierePermiso(Ver)?\(|guardarReceta\(/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

/** Cuerpo de cada `export async function` de un archivo: desde su firma hasta la firma de la siguiente. */
function funcionesExportadas(fuente: string): Array<{ nombre: string; texto: string }> {
  const inicios = [...fuente.matchAll(/^export async function (\w+)/gm)];
  return inicios.map((m, i) => ({ nombre: m[1], texto: fuente.slice(m.index, inicios[i + 1]?.index ?? fuente.length) }));
}

describe("server actions: toda función exportada lleva una guarda de acceso", () => {
  const conUseServer = archivos(RAIZ).filter((ruta) => /^\s*["']use server["']/.test(readFileSync(ruta, "utf8").slice(0, 200)));

  it("encuentra los archivos de acciones", () => {
    expect(conUseServer.length).toBeGreaterThan(10);
  });

  it("ninguna función exportada de un archivo 'use server' queda sin guarda", () => {
    const sinGuarda: string[] = [];
    for (const ruta of conUseServer) {
      const fuente = readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");
      for (const f of funcionesExportadas(fuente)) {
        if (!GUARDAS.test(f.texto)) sinGuarda.push(`${ruta.slice(RAIZ.length + 1).split(sep).join("/")} → ${f.nombre}`);
      }
    }
    expect(sinGuarda, `Funciones exportadas de archivos "use server" sin guarda de acceso:\n${sinGuarda.join("\n")}`).toEqual([]);
  });

  it("los archivos con guarda de lectura (con-sesion.ts) y de escritura (con-permiso.ts) no llevan 'use server'", () => {
    for (const nombre of ["con-sesion.ts", "con-permiso.ts", "catalogo/upsert-proveedor-por-producto.ts"]) {
      const cabecera = readFileSync(join(RAIZ, nombre), "utf8").slice(0, 200);
      expect(cabecera, `${nombre} no puede llevar "use server": sus exports serían endpoints`).not.toMatch(/^\s*["']use server["']/);
    }
  });
});
