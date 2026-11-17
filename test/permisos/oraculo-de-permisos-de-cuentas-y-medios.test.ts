import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, contextoDeAccion, esAccionSoloVer, moduloDeAccion, nivelMinimoDeAccion, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { accesoDeSucursal, decidirEnSucursal, nivelEnSucursal, type PermisoLeido } from "../../src/core/permisos/decision-de-acceso";
import { CLAVES_DE_PR_B, CLAVES_DEL_CIERRE } from "./oraculo-de-permisos-del-cierre";
import { CLAVES_DE_CUENTAS_Y_MEDIOS, PUERTA_ESPERADA_DE_CUENTAS_Y_MEDIOS, type ActorDeCuentasYMedios } from "./oraculo-de-permisos-de-cuentas-y-medios";

/**
 * Oráculo rol × piso × clave de los ocho permisos de administración de la caja (etapa B: medios de pago y cuentas de cobro; decisiones Q-B1 y Q-B3 confirmadas por delegación del dueño en Pedernal el 2026-11-17). La tabla de reglas esperadas está APARTE del código, en
 * `oraculo-de-permisos-de-cuentas-y-medios.ts`; este test recorre TODAS las combinaciones (8 claves × 7 actores × ver/editar = 112) contra la decisión de acceso REAL (`accesoDeSucursal` + `decidirEnSucursal`, funciones puras: sin base) y compara con esa tabla.
 *
 * Además fija el catálogo (`ACCIONES`) contra el oráculo: contexto sucursal, módulo provisorio `salon`, piso, solo ver y semilla SOLO `admin`; fija CADA acción real de `cuentas-y-medios.ts` a su clave (por el código fuente: la acción `crearCuentaDeCobroDeCaja` se envuelve con
 * `conPermiso("caja_cuenta_de_cobro_crear", …)` y con ninguna otra); y un GUARDIÁN de dimensiones: toda clave `caja_*` del catálogo está declarada en algún oráculo de caja (este, el del cierre del día o las seis de PR-B); una clave nueva sin declarar pone esto en rojo.
 *
 * Mutaciones (rojo/verde, comprobadas a mano al escribirlo, ver el informe de la etapa): cambiar el piso de una clave en `acciones.ts` a «administrador» → rojo en «el catálogo declara…» y en el conteo de pisos; quitar una clave de `acciones.ts` → rojo en «ninguna clave del oráculo…»;
 * usar la clave equivocada en una acción de `cuentas-y-medios.ts` → rojo en «cada acción real…» (y en `test/caja/cuentas-y-medios-acciones.test.ts`); agregar `caja_x` al catálogo sin declararla → rojo en el guardián; sacar una clave de la semilla de la migración → rojo en `migracion-permisos-cuentas-y-medios.test.ts`.
 */
const FILA_PRENDIDA: PermisoLeido = { puedeVer: true, puedeEditar: true };

/** Cómo se arma cada actor frente a la puerta real: membresía (con la clave de su rol) y fila de la matriz. */
const ACTORES: Readonly<Record<ActorDeCuentasYMedios, { membresia: { rol: { clave: string | null; nombre: string; activo: boolean } } | null; fila: PermisoLeido | null }>> = {
  "gerente (rol admin, fila semilla)": { membresia: { rol: { clave: "admin", nombre: "Administrador", activo: true } }, fila: FILA_PRENDIDA },
  "administrador (rol admin, fila semilla)": { membresia: { rol: { clave: "admin", nombre: "Administrador", activo: true } }, fila: FILA_PRENDIDA },
  "operador con la fila prendida a mano": { membresia: { rol: { clave: "operador", nombre: "Empleado", activo: true } }, fila: FILA_PRENDIDA },
  "operador sin fila": { membresia: { rol: { clave: "operador", nombre: "Empleado", activo: true } }, fila: null },
  "rol propio con la fila prendida": { membresia: { rol: { clave: null, nombre: "Cajero", activo: true } }, fila: FILA_PRENDIDA },
  "rol propio sin fila": { membresia: { rol: { clave: null, nombre: "Cajero", activo: true } }, fila: null },
  "sin membresía": { membresia: null, fila: FILA_PRENDIDA },
};

const CLAVES = Object.keys(CLAVES_DE_CUENTAS_Y_MEDIOS);

describe("oráculo de permisos de administración de la caja: clave × actor × (ver | editar)", () => {
  for (const clave of CLAVES) {
    describe(clave, () => {
      for (const [actor, hechos] of Object.entries(ACTORES) as [ActorDeCuentasYMedios, (typeof ACTORES)[ActorDeCuentasYMedios]][]) {
        it(`${actor}`, () => {
          const esperado = PUERTA_ESPERADA_DE_CUENTAS_Y_MEDIOS[CLAVES_DE_CUENTAS_Y_MEDIOS[clave].piso as "operario"][actor];
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

  it("el catálogo declara las ocho como el oráculo: sucursal, módulo provisorio salon, piso, solo ver y semilla SOLO admin", () => {
    for (const clave of CLAVES) {
      const a = ACCIONES.find((x) => x.clave === clave)!;
      expect(contextoDeAccion(a.clave), clave).toBe("sucursal");
      expect(moduloDeAccion(a.clave), clave).toBe("salon");
      expect(nivelMinimoDeAccion(a.clave), clave).toBe(CLAVES_DE_CUENTAS_Y_MEDIOS[clave].piso);
      expect(esAccionSoloVer(a.clave), clave).toBe(CLAVES_DE_CUENTAS_Y_MEDIOS[clave].soloVer);
      expect([...a.rolesEditarSemilla], clave).toEqual(["admin"]);
    }
  });

  it("GUARDIÁN: toda clave `caja_*` del catálogo está declarada en el oráculo (o del cierre del día, o una de las seis de PR-B, con su cobertura propia); una nueva sin declarar falla", () => {
    const declaradas = new Set<string>([...CLAVES, ...Object.keys(CLAVES_DEL_CIERRE), ...CLAVES_DE_PR_B]);
    const sinDeclarar = ACCIONES.map((a) => a.clave as string).filter((c) => c.startsWith("caja_") && !declaradas.has(c));
    expect(sinDeclarar, "agregá la clave a CLAVES_DE_CUENTAS_Y_MEDIOS con su piso y sus actores, o declarala de otra etapa").toEqual([]);
  });

  it("el oráculo es exhaustivo en sus propias dimensiones: cada piso declarado tiene la fila de los siete actores", () => {
    const pisos = new Set(CLAVES.map((c) => CLAVES_DE_CUENTAS_Y_MEDIOS[c].piso));
    expect([...pisos].sort()).toEqual(["operario"]);
    for (const piso of pisos) expect(Object.keys(PUERTA_ESPERADA_DE_CUENTAS_Y_MEDIOS[piso as "operario"]).sort()).toEqual(Object.keys(ACTORES).sort());
  });
});

describe("cada acción real de administración queda atada a SU clave (por el código fuente)", () => {
  const fuente = readFileSync(join(__dirname, "../../src/server/actions/caja/cuentas-y-medios.ts"), "utf8");
  /** El cuerpo de `export async function <nombre>(…) {…}` hasta la siguiente acción exportada. */
  const cuerpoDe = (nombre: string): string => {
    const inicio = fuente.indexOf(`export async function ${nombre}(`);
    expect(inicio, `${nombre} no existe en cuentas-y-medios.ts`).toBeGreaterThanOrEqual(0);
    const siguiente = fuente.indexOf("export async function ", inicio + 10);
    return fuente.slice(inicio, siguiente === -1 ? undefined : siguiente);
  };

  for (const clave of CLAVES) {
    it(`${CLAVES_DE_CUENTAS_Y_MEDIOS[clave].accion} se envuelve con conPermiso("${clave}") y con ninguna otra clave`, () => {
      const cuerpo = cuerpoDe(CLAVES_DE_CUENTAS_Y_MEDIOS[clave].accion);
      const claves = [...cuerpo.matchAll(/conPermiso\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
      expect(claves).toEqual([clave]);
    });
  }

  it("las ocho acciones son todas las que exporta el archivo (una acción nueva sin clave declarada falla)", () => {
    const exportadas = [...fuente.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]).sort();
    expect(exportadas).toEqual(CLAVES.map((c) => CLAVES_DE_CUENTAS_Y_MEDIOS[c].accion).sort());
  });
});
