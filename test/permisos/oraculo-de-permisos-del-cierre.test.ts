import { describe, expect, it } from "vitest";
import { ACCIONES, contextoDeAccion, esAccionSoloVer, moduloDeAccion, nivelMinimoDeAccion, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { accesoDeSucursal, decidirEnSucursal, nivelEnSucursal, type PermisoLeido } from "../../src/core/permisos/decision-de-acceso";
import { CLAVES_DE_PR_B, CLAVES_DEL_CIERRE, PUERTA_ESPERADA, type ActorDelCierre } from "./oraculo-de-permisos-del-cierre";

/**
 * Oráculo rol × piso × clave de los siete permisos del cierre del día (etapa A; tabla confirmada por el dueño 2026-11-17, «ok pedernal»). La tabla de reglas esperadas está APARTE del código, en `oraculo-de-permisos-del-cierre.ts`;
 * este test recorre TODAS las combinaciones (7 claves × 7 actores × ver/editar = 98) contra la decisión de acceso REAL (`accesoDeSucursal` + `decidirEnSucursal`, funciones puras: sin base) y compara con esa tabla.
 *
 * Además fija el catálogo (`ACCIONES`) contra el oráculo: contexto sucursal, módulo provisorio `salon`, piso, solo ver y semilla SOLO `admin`; y un GUARDIÁN de dimensiones: toda clave `caja_*` del catálogo está declarada en el oráculo
 * (o es una de las seis de PR-B, con su cobertura propia); una clave nueva sin declarar pone esto en rojo.
 *
 * Mutaciones (rojo/verde, comprobadas a mano al escribirlo): bajar el piso de `caja_registrar_ajuste` a «operario» en `acciones.ts` → rojo en «combinaciones» (operador con fila y rol propio con fila pasarían) y en «el catálogo declara…»;
 * quitar una clave de `acciones.ts` → rojo en «el catálogo declara…» y en «ninguna clave del oráculo…»; sacar una clave de la semilla de la migración → rojo en `migracion-permisos-cierre-del-dia.test.ts`; agregar `caja_x` al catálogo sin declararla → rojo en el guardián.
 */
const FILA_PRENDIDA: PermisoLeido = { puedeVer: true, puedeEditar: true };

/** Cómo se arma cada actor frente a la puerta real: membresía (con la clave de su rol) y fila de la matriz. */
const ACTORES: Readonly<Record<ActorDelCierre, { membresia: { rol: { clave: string | null; nombre: string; activo: boolean } } | null; fila: PermisoLeido | null }>> = {
  "gerente (rol admin, fila semilla)": { membresia: { rol: { clave: "admin", nombre: "Administrador", activo: true } }, fila: FILA_PRENDIDA },
  "administrador (rol admin, fila semilla)": { membresia: { rol: { clave: "admin", nombre: "Administrador", activo: true } }, fila: FILA_PRENDIDA },
  "operador con la fila prendida a mano": { membresia: { rol: { clave: "operador", nombre: "Empleado", activo: true } }, fila: FILA_PRENDIDA },
  "operador sin fila": { membresia: { rol: { clave: "operador", nombre: "Empleado", activo: true } }, fila: null },
  "rol propio con la fila prendida": { membresia: { rol: { clave: null, nombre: "Cajero", activo: true } }, fila: FILA_PRENDIDA },
  "rol propio sin fila": { membresia: { rol: { clave: null, nombre: "Cajero", activo: true } }, fila: null },
  "sin membresía": { membresia: null, fila: FILA_PRENDIDA },
};

const CLAVES = Object.keys(CLAVES_DEL_CIERRE);

describe("oráculo de permisos del cierre del día: clave × actor × (ver | editar)", () => {
  for (const clave of CLAVES) {
    describe(clave, () => {
      for (const [actor, hechos] of Object.entries(ACTORES) as [ActorDelCierre, (typeof ACTORES)[ActorDelCierre]][]) {
        it(`${actor}`, () => {
          const esperado = PUERTA_ESPERADA[CLAVES_DEL_CIERRE[clave].piso as "operario" | "administrador"][actor];
          const accion = clave as AccionDeSucursal;
          const acceso = accesoDeSucursal({ membresia: hechos.membresia, filaDelRol: hechos.fila, sinModulo: null, tieneCapacidad: true }, accion);
          expect(decidirEnSucursal(acceso, accion, "editar").ok, `${clave} editar`).toBe(esperado);
          expect(decidirEnSucursal(acceso, accion, "ver").ok, `${clave} ver`).toBe(esperado);
          expect(nivelEnSucursal(acceso), `${clave} nivel`).toEqual({ ver: esperado, editar: esperado });
        });
      }
    });
  }
});

describe("el catálogo (ACCIONES) coincide con el oráculo y el guardián de dimensiones", () => {
  it("ninguna clave del oráculo falta en el catálogo", () => {
    for (const clave of CLAVES) expect(ACCIONES.find((a) => a.clave === clave), clave).toBeDefined();
  });

  it("el catálogo declara las siete como el oráculo: sucursal, módulo provisorio salon, piso, solo ver y semilla SOLO admin", () => {
    for (const clave of CLAVES) {
      const a = ACCIONES.find((x) => x.clave === clave)!;
      expect(contextoDeAccion(a.clave), clave).toBe("sucursal");
      expect(moduloDeAccion(a.clave), clave).toBe("salon");
      expect(nivelMinimoDeAccion(a.clave), clave).toBe(CLAVES_DEL_CIERRE[clave].piso);
      expect(esAccionSoloVer(a.clave), clave).toBe(CLAVES_DEL_CIERRE[clave].soloVer);
      expect([...a.rolesEditarSemilla], clave).toEqual(["admin"]);
    }
  });

  it("GUARDIÁN: toda clave `caja_*` del catálogo está declarada en el oráculo (o es una de las seis de PR-B, con su cobertura propia); una nueva sin declarar falla", () => {
    const declaradas = new Set<string>([...CLAVES, ...CLAVES_DE_PR_B]);
    const sinDeclarar = ACCIONES.map((a) => a.clave as string).filter((c) => c.startsWith("caja_") && !declaradas.has(c));
    expect(sinDeclarar, "agregá la clave a CLAVES_DEL_CIERRE con su piso y sus actores, o declarala de otra etapa").toEqual([]);
  });

  it("el oráculo es exhaustivo en sus propias dimensiones: cada piso declarado tiene la fila de los siete actores", () => {
    const pisos = new Set(CLAVES.map((c) => CLAVES_DEL_CIERRE[c].piso));
    expect([...pisos].sort()).toEqual(["administrador", "operario"]);
    for (const piso of pisos) expect(Object.keys(PUERTA_ESPERADA[piso as "operario" | "administrador"]).sort()).toEqual(Object.keys(ACTORES).sort());
  });
});
