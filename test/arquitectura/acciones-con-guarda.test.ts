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
 * - `getUsuarioActual()` / `obtenerContextoUsuario()` / `requierePermiso*(...)` / `invitacionDelToken(...)` puestos a mano: casos puntuales,
 *   en LISTA CERRADA con su motivo (`GUARDAS_A_MANO`, abajo). Una de estas guardas solo prueba que hay sesión (o un token): no pide el
 *   «Ver»/«Editar» de ninguna pantalla, así que una lectura nueva abierta así le devolvería sus datos a cualquier usuario logueado y pasaría
 *   por al lado de `lecturas-con-sesion-lista-cerrada` (que solo mira `requerirSesion*`). Pre-paso P de la Fase I-B del Hito 3.
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

/** Las guardas «de envoltorio»: piden el permiso de una pantalla (con-permiso.ts, con-sesion.ts). Cualquier otra que reconozca el analizador es «a mano». */
const GUARDAS_DE_ENVOLTORIO = new Set([
  "conPermiso", "conPermisoDeEmpresa", "conEdicionDePermisos",
  "requerirVer", "requerirVerEnSucursal", "requerirVerDeEmpresa", "requerirVerAlguna", "requerirVerAlgunaEnSucursal",
]);

/**
 * `archivo relativo a src/server/actions|función exportada` → `guarda a mano que la abre — motivo`. Lista CERRADA (pre-paso P de la Fase I-B del Hito 3,
 * pedido de la auditoría de seguridad): una función nueva abierta con una guarda a mano pone el test en rojo hasta que se la anote acá con su motivo (o,
 * mejor, se la abra con `requerirVer*`/`conPermiso*`). Fuera del recorrido quedan `con-sesion.ts` y `con-permiso.ts` (no son "use server": ahí las guardas
 * a mano son la implementación de las de envoltorio).
 */
const GUARDAS_A_MANO: Readonly<Record<string, string>> = {
  "auth/invitacion.ts|abrirInvitacion":
    "invitacionDelToken — previa al login: la autoridad es conocer el token de la invitación, que se valida contra la base antes de guardar la cookie",
  "auth/invitacion.ts|aceptarMiInvitacion":
    "getUsuarioActual — quien acepta todavía no tiene membresía (CASOS_SIN_PERMISO): la autoridad es el token de la cookie httpOnly, que valida el caso de uso",
  "auth/invitacion.ts|aceptarMiInvitacionDeUsuario":
    "getUsuarioActual — ídem: sin membresía todavía; el token lo valida el caso de uso, que además revalida el permiso del otorgante con el requierePermiso real",
  "auth/empresa-activa.ts|cambiarEmpresaActiva":
    "getUsuarioActual — preferencia de cookie (empresa activa): solo entre pertenencias activas que valida contra la base; no escala privilegio",
  "auth/sucursal-activa.ts|cambiarSucursalActiva":
    "obtenerContextoUsuario — preferencia de cookie (sucursal activa): solo entre membresías activas que valida contra la base; no escala privilegio",
  "catalogo/unidades.ts|detectarInsumosConUnidadMezclada":
    "obtenerContextoUsuario — lectura con el gate inline de insumos_mezclados (requierePermisoDeEmpresa) porque devuelve datos y no un ResultadoAccion",
};

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

  it("las funciones abiertas con una guarda a mano son exactamente las de GUARDAS_A_MANO, y con la guarda anotada", () => {
    const reales: Record<string, string> = {};
    for (const { ruta, fuente } of rutasDeAcciones) {
      const nombreRelativo = ruta.slice(RAIZ.length + 1).split(sep).join("/");
      for (const f of analizarFuente(ruta, fuente).funciones) {
        if (f.estado === "ok" && f.guarda && !GUARDAS_DE_ENVOLTORIO.has(f.guarda)) reales[`${nombreRelativo}|${f.nombre}`] = f.guarda;
      }
    }
    const sobran = Object.keys(reales).filter((k) => !(k in GUARDAS_A_MANO));
    const faltan = Object.keys(GUARDAS_A_MANO).filter((k) => !(k in reales));
    expect(sobran, `Funciones NUEVAS abiertas con una guarda a mano (abrilas con requerirVer*/conPermiso*, o anotalas con su motivo):\n${sobran.map((k) => `${k} (${reales[k]})`).join("\n")}`).toEqual([]);
    expect(faltan, `Ya no abren con una guarda a mano: sacalas de GUARDAS_A_MANO:\n${faltan.join("\n")}`).toEqual([]);
    const otraGuarda = Object.keys(reales).filter((k) => !GUARDAS_A_MANO[k].startsWith(`${reales[k]} — `));
    expect(otraGuarda, `La guarda a mano cambió (el motivo anotado ya no corresponde):\n${otraGuarda.map((k) => `${k}: ahora ${reales[k]}`).join("\n")}`).toEqual([]);
  });

  it("los archivos con guarda de lectura (con-sesion.ts) y de escritura (con-permiso.ts) no llevan 'use server'", () => {
    for (const nombre of ["con-sesion.ts", "con-permiso.ts", "pos/cuenta-comun.ts"]) {
      const ruta = join(RAIZ, nombre);
      const fuente = readFileSync(ruta, "utf8");
      expect(analizarFuente(ruta, fuente).esArchivoDeAcciones, `${nombre} no puede llevar "use server": sus exports serían endpoints`).toBe(false);
    }
  });
});
