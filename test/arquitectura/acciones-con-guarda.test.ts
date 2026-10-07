import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarFuente } from "./guardas/analizador";

/**
 * Regla de arquitectura: toda función que exporta un archivo `"use server"` es un endpoint que se puede invocar
 * directo, sin pasar por la página que la usa. Por eso cada una tiene que abrir con una guarda de acceso. Este test
 * recorre `src/server/actions` y falla si aparece una función exportada sin ninguna de las guardas reconocidas:
 *
 * - `conPermiso(...)`: mutaciones, con permiso de Editar (ver con-permiso.ts).
 * - `requerirVer(clave)` / `requerirVerEnSucursal(id, clave)` / `requerirVerDeEmpresa(clave)`: lecturas, con sesión (y membresía en la
 *   sucursal pedida) y el permiso de Ver de su pantalla (ver con-sesion.ts).
 * - `requerirVerAlguna(claves)` / `requerirVerAlgunaEnSucursal(id, claves)`: lecturas que consumen pantallas con claves distintas: el
 *   «Ver» de alguna de ellas (H8). Desde H8 ninguna lectura abre con solo sesión (`requerirSesion` ya no se exporta).
 * - `getUsuarioActual()` / `obtenerContextoUsuario()` / `requierePermiso*(...)` puestos a mano: casos puntuales.
 * - Delegación: llamar a otra función exportada del mismo archivo que a su vez esté guardada (ej. `agregarIngredienteAReceta`
 *   delega en `guardarReceta`).
 *
 * A diferencia de una versión anterior (por regex sobre el texto), esto analiza el AST real (`test/arquitectura/guardas/analizador.ts`,
 * con sus propios tests en `analizador-de-guardas.test.ts`): no lo engaña una guarda mencionada en un comentario o un string, detecta
 * cuando la guarda llega DESPUÉS de una lectura de base, y cuando su resultado se llama sin `await` (queda descartado, la lógica de
 * abajo corre igual). Sigue siendo estático: no ejecuta nada, y no verifica que la CLAVE de la guarda sea la correcta para esa
 * pantalla (eso lo cubre `test/permisos/lecturas-con-permiso-de-ver.test.ts` y `test/arquitectura/reportes-con-permiso.test.ts`). Una
 * función que de verdad no debe llevar guarda (un ayudante interno) va en un archivo SIN `"use server"`, no acá.
 */
const RAIZ = join(__dirname, "../../src/server/actions");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith(".ts") ? [ruta] : [];
  });
}

const rutasDeAcciones = archivos(RAIZ)
  .map((ruta) => ({ ruta, fuente: readFileSync(ruta, "utf8").replace(/\r\n/g, "\n") }))
  .filter(({ ruta, fuente }) => analizarFuente(ruta, fuente).esArchivoDeAcciones);

describe("server actions: toda función exportada lleva una guarda de acceso", () => {
  it("encuentra los archivos de acciones", () => {
    expect(rutasDeAcciones.length).toBeGreaterThan(10);
  });

  it("ninguna función exportada de un archivo 'use server' queda sin guarda, con guarda tardía o con la guarda descartada", () => {
    const problemas: string[] = [];
    for (const { ruta, fuente } of rutasDeAcciones) {
      const nombreRelativo = ruta.slice(RAIZ.length + 1).split(sep).join("/");
      const { funciones } = analizarFuente(ruta, fuente);
      for (const f of funciones) {
        if (f.estado !== "ok") problemas.push(`${nombreRelativo}:${f.linea} ${f.nombre} → ${f.estado}`);
      }
    }
    expect(problemas, `Funciones exportadas de archivos "use server" con guarda ausente/tardía/descartada, o con una forma de export no reconocida:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("los archivos con guarda de lectura (con-sesion.ts) y de escritura (con-permiso.ts) no llevan 'use server'", () => {
    for (const nombre of ["con-sesion.ts", "con-permiso.ts", "pos/cuenta-comun.ts"]) {
      const ruta = join(RAIZ, nombre);
      const fuente = readFileSync(ruta, "utf8");
      expect(analizarFuente(ruta, fuente).esArchivoDeAcciones, `${nombre} no puede llevar "use server": sus exports serían endpoints`).toBe(false);
    }
  });
});
