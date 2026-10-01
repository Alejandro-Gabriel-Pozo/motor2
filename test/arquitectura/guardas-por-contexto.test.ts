import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, contextoDeAccion } from "../../src/core/permisos/acciones";
import { inventariarDirectorio, inventariarFuente } from "./guardas/inventario";

/**
 * Una acción de CONTEXTO EMPRESA se guarda con las guardas «DeEmpresa» (valen si cualquier membresía de la empresa tiene la clave); una de
 * CONTEXTO SUCURSAL, con las de sucursal (valen en la sucursal activa). Los tipos (`AccionDeEmpresa` / `AccionDeSucursal`) ya lo impiden al
 * compilar; este guardián mira el código ya escrito, así que también agarra un `as` que lo esquive. El menú y la pantalla de inicio juntan
 * las dos y usan `accionesDelMenuQueElUsuarioPuedeVer`, que reparte cada clave por su contexto: es la única que acepta de los dos.
 */
const GUARDAS_DE_EMPRESA = new Set(["conPermisoDeEmpresa", "conEdicionDePermisos", "requerirVerDeEmpresa", "requierePermisoDeEmpresa", "requierePermisoVerDeEmpresa", "obtenerMiNivelPermisoDeEmpresa"]);
const GUARDAS_MIXTAS = new Set(["accionesDelMenuQueElUsuarioPuedeVer"]);

const SRC = join(__dirname, "../../src");
const contextoDe = new Map<string, string>(ACCIONES.map((a) => [a.clave, contextoDeAccion(a.clave)]));

function usosFueraDeContexto(usos: { clave: string; funcion: string }[]): string[] {
  return usos
    .filter((u) => !GUARDAS_MIXTAS.has(u.funcion))
    .filter((u) => (GUARDAS_DE_EMPRESA.has(u.funcion) ? "empresa" : "sucursal") !== contextoDe.get(u.clave))
    .map((u) => `${u.funcion}("${u.clave}") es una acción de ${contextoDe.get(u.clave)}`);
}

describe("las guardas coinciden con el contexto de la clave", () => {
  it("ningún sitio de src/ guarda una acción de empresa con una guarda de sucursal, ni al revés", () => {
    const { usos } = inventariarDirectorio(SRC);
    const fuera = usos.filter((u) => usosFueraDeContexto([u]).length).map((u) => `${u.archivo}:${u.linea} ${usosFueraDeContexto([u])[0]}`);
    expect(fuera, `Guarda de un contexto con una clave del otro:\n${fuera.join("\n")}`).toEqual([]);
  });

  it("el detector agarra una clave de empresa en una guarda de sucursal, y una de sucursal en una de empresa", () => {
    const mal = inventariarFuente(
      "f.ts",
      ['await requierePermiso(ctx.usuarioId, ctx.sucursalId, "alta_producto" as never, ctx.db);', 'await conPermisoDeEmpresa("ver_stock" as never, async () => ({ ok: true }));'].join("\n")
    );
    expect(usosFueraDeContexto(mal.usos)).toEqual(['requierePermiso("alta_producto") es una acción de empresa', 'conPermisoDeEmpresa("ver_stock") es una acción de sucursal']);
  });

  it("cada acción de empresa del catálogo se guarda al menos una vez con una guarda de empresa (y las de sucursal, nunca con una de empresa)", () => {
    const { usos } = inventariarDirectorio(SRC);
    const porClave = new Map<string, Set<string>>();
    for (const u of usos) porClave.set(u.clave, (porClave.get(u.clave) ?? new Set()).add(u.funcion));
    const sinGuardaDeEmpresa = ACCIONES.filter((a) => contextoDeAccion(a.clave) === "empresa")
      .map((a) => a.clave)
      .filter((clave) => porClave.has(clave) && ![...porClave.get(clave)!].some((f) => GUARDAS_DE_EMPRESA.has(f) || GUARDAS_MIXTAS.has(f)));
    expect(sinGuardaDeEmpresa).toEqual([]);
  });
});
