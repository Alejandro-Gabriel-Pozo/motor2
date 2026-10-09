import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { requierePermiso, requierePermisoDeEmpresa, requierePermisoVer, requierePermisoVerDeEmpresa } from "../../src/server/acceso/gate";
import { ACCIONES, contextoDeAccion, moduloDeAccion, type AccionClave, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { MODULOS } from "../../src/core/modulos/catalogo";
import { modulosQueIncluyen } from "../../src/core/modulos/clausura";

/**
 * GT-12 del plan de endurecimiento de seguridad (S-22, tanda T10; la mitad de la carta pública queda para la tanda T9): MÓDULO APAGADO ⇒ RECHAZO EN EL SERVIDOR,
 * para TODA acción del catálogo y no solo las que alguien pensó probar. Lo contratado manda: una pantalla oculta no es una barrera (una Server Action se llama a
 * mano), así que el rechazo tiene que estar en el último punto donde se decide, el guard (`conPermiso*` → `requierePermiso*`), antes de mirar la capacidad o el rol.
 *
 * Para cada módulo del catálogo que no es el fijo (Administración, que no se apaga): se arma el registro de la empresa con los vendibles que NO lo traen (ni él ni
 * ninguno que lo requiera, por la clausura del catálogo) y se verifica, para un administrador que tiene todas las claves, que CADA acción de ese módulo se niega
 * con el motivo «módulo no activo» en el gate de editar y en el de ver (y es la misma respuesta para las acciones de empresa y las de sucursal). El control inverso:
 * con el módulo prendido la respuesta NO es «módulo no activo» (puede ser un OK o cualquier otra denegación, pero nunca ésa).
 *
 * Que el POS rechaza con Salón apagado puerta por puerta, con cero filas escritas, lo prueba `test/pos/modulos-apagados-en-el-pos.test.ts`.
 */
const E = EMPRESA_POR_DEFECTO_ID;

const editar = (usuarioId: string, sucursalId: string, clave: AccionClave) =>
  contextoDeAccion(clave) === "empresa" ? requierePermisoDeEmpresa(usuarioId, E, clave as AccionDeEmpresa, prisma) : requierePermiso(usuarioId, sucursalId, clave as AccionDeSucursal, prisma);
const ver = (usuarioId: string, sucursalId: string, clave: AccionClave) =>
  contextoDeAccion(clave) === "empresa" ? requierePermisoVerDeEmpresa(usuarioId, E, clave as AccionDeEmpresa, prisma) : requierePermisoVer(usuarioId, sucursalId, clave as AccionDeSucursal, prisma);

/** Los módulos del catálogo que se pueden apagar (todos menos el fijo). */
const APAGABLES = MODULOS.filter((m) => m.tipo !== "fijo").map((m) => m.id);

/** El registro de la empresa con todos los vendibles que NO traen `modulo`: con él, `modulo` queda fuera de los módulos efectivos. */
function registroSin(modulo: string): string[] {
  return MODULOS_VENDIBLES.filter((v) => modulosQueIncluyen(modulo, [v]).length === 0);
}

let admin: { id: string };
let sucursalId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
});

describe("GT-12 · toda acción de un módulo apagado se rechaza en el servidor", () => {
  it("cada acción del catálogo es de un módulo que existe, y cada módulo apagable tiene al menos una acción (si no, el test de abajo no probaría nada)", () => {
    const ids = new Set<string>(MODULOS.map((m) => m.id));
    expect(ACCIONES.filter((a) => !ids.has(a.modulo)).map((a) => a.clave)).toEqual([]);
    const sinAcciones = APAGABLES.filter((m) => !ACCIONES.some((a) => a.modulo === m));
    expect(sinAcciones).toEqual([]);
  });

  it("el registro «sin M» deja a M fuera de lo efectivo y a Administración dentro (la construcción del escenario es la correcta)", () => {
    for (const m of APAGABLES) {
      expect(modulosQueIncluyen(m, registroSin(m)), m).toEqual([]);
    }
    // Salón apagado deja prendido todo lo demás que no lo requiere; Catálogo básico, que lo requiere casi todo, deja un registro vacío.
    expect(registroSin("salon")).not.toContain("salon");
    expect(registroSin("catalogo_basico")).toEqual([]);
  });

  it.each(APAGABLES)("con %s apagado, TODAS sus acciones se niegan por módulo (editar y ver)", async (modulo) => {
    await fijarModulosActivos(E, registroSin(modulo));
    const acciones = ACCIONES.filter((a) => a.modulo === modulo).map((a) => a.clave as AccionClave);
    const fallas: string[] = [];
    for (const clave of acciones) {
      for (const [gate, nombre] of [[editar, "editar"], [ver, "ver"]] as const) {
        const r = await gate(admin.id, sucursalId, clave);
        if (!(r.ok === false && r.motivo === "MODULO_NO_ACTIVO" && r.modulo === modulo)) fallas.push(`${clave} (${nombre}): ${JSON.stringify(r)}`);
      }
    }
    expect(fallas).toEqual([]);
    expect(acciones.length).toBeGreaterThan(0);
  });

  it.each(APAGABLES)("CONTROL con %s prendido: ninguna de sus acciones responde «módulo no activo»", async (modulo) => {
    await fijarModulosActivos(E, MODULOS_VENDIBLES);
    const acciones = ACCIONES.filter((a) => a.modulo === modulo).map((a) => a.clave as AccionClave);
    const fallas: string[] = [];
    for (const clave of acciones) {
      for (const [gate, nombre] of [[editar, "editar"], [ver, "ver"]] as const) {
        const r = await gate(admin.id, sucursalId, clave);
        if (r.ok === false && r.motivo === "MODULO_NO_ACTIVO") fallas.push(`${clave} (${nombre})`);
      }
    }
    expect(fallas).toEqual([]);
  });

  it("las acciones de Administración (módulo fijo) nunca se niegan por módulo, ni con el registro vacío", async () => {
    await fijarModulosActivos(E, []);
    const fallas: string[] = [];
    for (const a of ACCIONES.filter((x) => moduloDeAccion(x.clave as AccionClave) === "administracion")) {
      for (const gate of [editar, ver]) {
        const r = await gate(admin.id, sucursalId, a.clave as AccionClave);
        if (r.ok === false && (r.motivo === "MODULO_NO_ACTIVO" || r.motivo === "MODULO_EN_DESARROLLO")) fallas.push(a.clave);
      }
    }
    expect(fallas).toEqual([]);
  });
});
