import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envoltoriosDe, type Envoltorio } from "./guardas/envoltorio-y-clave";

/**
 * Server Action de gobierno → envoltorio y clave (Hito 3, paso 0.4 de `docs/plan-hito-3-pureza.md`).
 *
 * Las 16 mutaciones de auth y permisos se mueven a casos de uso en la Fase I. Lo que NO puede cambiar en ese movimiento es con qué envoltorio y con qué clave
 * entra cada una: `conEdicionDePermisos` y `conPermisoDeEmpresa` reciben el mismo tipo (`AccionDeEmpresa`), así que cambiar uno por el otro compila y saltea la
 * política de plataforma (ADR-008) sin que tsc diga nada; y cambiar `"gestion_roles"` por otra clave de empresa también compila. Este guardián lee el AST de
 * cada archivo y exige, por cada función exportada que llama a un envoltorio de mutación: que sea una de la lista (lista cerrada: una mutación nueva en estos
 * archivos se declara acá), que su PRIMERA sentencia sea `return <envoltorio>("<clave>", …)` (el guard antes que todo) y que envoltorio y clave sean los
 * declarados. Las lecturas (`listar*`) no llaman envoltorios de mutación y no entran (las cubre H8). El analizador (`envoltoriosDe`) vive desde el Hito 4
 * (paso 0.3) en `guardas/envoltorio-y-clave.ts`, movido tal cual: lo comparte con `pos-envoltorio-y-clave.test.ts`.
 */
const RAIZ = join(__dirname, "../../src/server/actions");

/** `archivo` (relativo a `src/server/actions`) → función exportada → envoltorio y clave. */
const DECLARADAS: Record<string, Record<string, { envoltorio: Envoltorio; clave: string }>> = {
  "permisos/capacidades-sucursal.ts": {
    actualizarCapacidad: { envoltorio: "conPermisoDeEmpresa", clave: "capacidades_sucursal" },
  },
  "permisos/roles.ts": {
    crearRol: { envoltorio: "conEdicionDePermisos", clave: "gestion_roles" },
    renombrarRol: { envoltorio: "conEdicionDePermisos", clave: "renombrar_rol" },
    actualizarActivoRol: { envoltorio: "conEdicionDePermisos", clave: "gestion_roles" },
  },
  "permisos/permisos.ts": {
    guardarPermisos: { envoltorio: "conEdicionDePermisos", clave: "gestion_permisos" },
  },
  "auth/sucursales.ts": {
    crearSucursalConAdmin: { envoltorio: "conPermisoDeEmpresa", clave: "alta_sucursal" },
    actualizarActivoSucursal: { envoltorio: "conPermisoDeEmpresa", clave: "activar_sucursal" },
    renombrarSucursal: { envoltorio: "conPermisoDeEmpresa", clave: "renombrar_sucursal" },
  },
  "auth/usuarios.ts": {
    agregarOActualizarUsuario: { envoltorio: "conPermiso", clave: "gestion_usuarios" },
    actualizarActivoMembresia: { envoltorio: "conPermiso", clave: "activar_usuario_sucursal" },
    actualizarNotasMembresia: { envoltorio: "conPermiso", clave: "notas_usuario_sucursal" },
    actualizarActivoUsuarioEnEmpresa: { envoltorio: "conPermisoDeEmpresa", clave: "apagar_cuenta_empresa" },
    transferirGerencia: { envoltorio: "conPermisoDeEmpresa", clave: "traspasar_gerencia" },
    reenviarInvitacionPendiente: { envoltorio: "conPermiso", clave: "gestion_usuarios" },
    revocarInvitacion: { envoltorio: "conPermiso", clave: "gestion_usuarios" },
    invitarAVincular: { envoltorio: "conPermiso", clave: "gestion_usuarios" },
  },
};

describe("gobierno: cada Server Action entra por su envoltorio y su clave", () => {
  it.each(Object.keys(DECLARADAS))("%s: las mutaciones son las declaradas, con su envoltorio y su clave como primera sentencia", (archivo) => {
    const encontradas = Object.fromEntries(Object.entries(envoltoriosDe(readFileSync(join(RAIZ, archivo), "utf8"))).map(([f, e]) => [f, e.entrada]));
    const esperadas = Object.fromEntries(Object.entries(DECLARADAS[archivo]).map(([f, d]) => [f, `${d.envoltorio}:${d.clave}`]));
    expect(
      encontradas,
      `${archivo}: una mutación cambió de envoltorio o de clave, o hay una nueva sin declarar. conEdicionDePermisos ↔ conPermisoDeEmpresa compila igual y saltea la política de plataforma: si el cambio es a propósito, declaralo acá.`
    ).toEqual(esperadas);
  });

  it("son las 16 mutaciones de auth y permisos", () => {
    expect(Object.values(DECLARADAS).reduce((n, fs) => n + Object.keys(fs).length, 0)).toBe(16);
  });

  it("el detector distingue envoltorio, clave y posición", () => {
    const fuente = [
      'export async function a() { return conEdicionDePermisos("gestion_roles", async () => ok("")); }',
      'export async function b() { return conPermisoDeEmpresa<R>("alta_sucursal", async () => ok("")); }',
      'export async function c() { const x = 1; return conPermiso("gestion_usuarios", async () => ok("")); }',
      'export async function d() { return conPermiso(clave, async () => ok("")); }',
      'export async function lectura() { const ctx = await requerirVer("x"); return ctx; }',
      'async function interna() { return conPermiso("gestion_usuarios", async () => ok("")); }',
      '// export async function comentada() { return conPermiso("gestion_usuarios", f); }',
    ].join("\n");
    expect(Object.fromEntries(Object.entries(envoltoriosDe(fuente)).map(([f, e]) => [f, e.entrada]))).toEqual({
      a: "conEdicionDePermisos:gestion_roles",
      b: "conPermisoDeEmpresa:alta_sucursal",
      c: "la primera sentencia no es `return <envoltorio>(…)`",
      d: "conPermiso: la clave no es un literal",
    });
  });
});
