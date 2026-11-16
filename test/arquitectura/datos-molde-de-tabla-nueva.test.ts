import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCEPCIONES,
  PRIMERA_MIGRACION_CON_MOLDE,
  aplicarExcepciones,
  migracionesConMolde,
  tablasCreadas,
  violacionesDeMolde,
  type Migracion,
} from "./datos-molde-de-tabla-nueva-apoyo";

/**
 * GUARDIÁN «MOLDE DE TABLA NUEVA» (frente 3, etapa E-0; docs/diseno-datos-paridad-pedernal-2026-11-16.md §4). Toda tabla que crea una migración desde el 2026-11-15 nace con la forma de
 * Pedernal: id `UUID` que manda la aplicación, instantes `TIMESTAMPTZ` y sin DELETE para la app (hay que revocarlo: el script del rol lo da por defecto). Pedido y citas: «Sí, copiar a
 * Pedernal en esas cinco» (2026-11-15) y «Datos: molde de tablas nuevas (E-0)» (2026-11-16), en `motor2-docs`, seguimiento-de-pedernal.
 *
 * Una tabla nueva que no cumple falla acá, nombrando la tabla y la regla. Si hay un motivo escrito va en `EXCEPCIONES` (en el apoyo), con la regla; la lista solo baja: una excepción que
 * ya no hace falta también falla. Detector y límites: `datos-molde-de-tabla-nueva-apoyo.ts`; una violación inyectada por cada regla: `datos-molde-de-tabla-nueva-evasiones.test.ts`.
 */
const RAIZ = join(__dirname, "../..");
const CARPETA = join(RAIZ, "prisma/migrations");

function leerMigraciones(): Migracion[] {
  return readdirSync(CARPETA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(CARPETA, e.name, "migration.sql")))
    .map((e) => ({ carpeta: e.name, sql: readFileSync(join(CARPETA, e.name, "migration.sql"), "utf8") }));
}

describe("molde de tabla nueva: las migraciones reales", () => {
  const todas = leerMigraciones();
  const conMolde = migracionesConMolde(todas);
  const violaciones = violacionesDeMolde(conMolde);
  const resultado = aplicarExcepciones(violaciones, EXCEPCIONES);

  it("el detector sigue leyendo las tablas (si no encuentra ninguna, el parser se rompió y el guardián no mira nada)", () => {
    const nombres = conMolde.flatMap((m) => tablasCreadas(m.sql, m.carpeta)).map((t) => t.nombre);
    expect(nombres).toContain("Parte");
    expect(nombres).toContain("OcultamientoProducto");
  });

  it("el corte existe como carpeta anterior o igual a las que se controlan", () => {
    expect(conMolde.length).toBeGreaterThan(0);
    expect(conMolde.every((m) => m.carpeta >= PRIMERA_MIGRACION_CON_MOLDE)).toBe(true);
  });

  it("ninguna tabla nueva se salta el molde (id UUID, instantes con zona, sin DELETE) fuera de las excepciones declaradas", () => {
    expect(resultado.sinExcepcion).toEqual([]);
  });

  it("cada excepción tiene motivo y sigue siendo necesaria", () => {
    expect(resultado.excepcionesInvalidas).toEqual([]);
  });

  it("`Parte`, la referencia del molde, cumple las tres reglas sin excepción", () => {
    expect(violaciones.filter((v) => v.tabla === "Parte")).toEqual([]);
  });
});
