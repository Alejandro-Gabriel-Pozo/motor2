import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, type NivelDeAccion } from "../../src/core/permisos/acciones";
import {
  PISO_INICIAL_POR_NIVEL,
  incumplimientosDeLaPlantilla,
  semillaDePlantillas,
  type CatalogoParaLasReglas,
  type IncumplimientoDeLaPlantilla,
  type PisoDeAccion,
  type PlantillaConLista,
} from "../../src/core/permisos/plantillas-y-pisos";
import { dimensionesDelOraculoDePlantillas, tablaDelOraculoDePlantillas } from "../setup/oraculo-plantillas-y-pisos";
import { productoCartesiano } from "../setup/oraculo-una-sola-compra";

/**
 * Combinaciones de plantillas y pisos (regla del 2026-10-28): recorre el producto cartesiano COMPLETO de las dimensiones declaradas en
 * `docs/oraculo-combinaciones-plantillas-y-pisos-2026-11-17.md` contra `incumplimientosDeLaPlantilla` y compara con la tabla del oráculo (escrita aparte del código). La acción «X» es sintética (nivel N, piso F,
 * conservada por el administrador A) para que cada combinación exista aunque el catálogo real no la tenga (por ejemplo, una acción de nivel operario que el administrador conserva siempre).
 */
const X = "accion_sintetica_x";
const primera = (r: IncumplimientoDeLaPlantilla[]): string => {
  const orden = ["NIVEL", "SOLO_GERENTE", "TODOS_LOS_ROLES", "ADMIN_SIEMPRE"] as const;
  const encontrada = orden.find((regla) => r.some((i) => i.regla === regla));
  return encontrada === undefined ? "PUBLICA" : `RECHAZA_${encontrada}`;
};
const pisosCon = (f: string): PisoDeAccion[] => [...semillaDePlantillas().pisos, ...(f === "SIN_PISO" ? [] : [{ accionClave: X, tipo: f as PisoDeAccion["tipo"] }])];
const catalogoCon = (n: string, a: string): CatalogoParaLasReglas => ({
  nivelDe: (clave) => (clave === X ? (n as NivelDeAccion) : ACCIONES.find((x) => x.clave === clave)?.nivelMinimo),
  requierenAdminSiempre: [...ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, ...(a === "SI" ? [X] : [])],
});

describe("combinaciones de plantillas y pisos contra el oráculo", () => {
  const dims = dimensionesDelOraculoDePlantillas();

  it("las dimensiones del oráculo son las esperadas (el guardián de arquitectura vigila que no aparezcan otras)", () => {
    expect(Object.keys(dims)).toEqual(["P", "N", "F", "A"]);
  });

  it("«Agregar a Ver»: el producto cartesiano P × N × F coincide fila por fila con el oráculo (y la tabla es exhaustiva)", () => {
    const tabla = tablaDelOraculoDePlantillas("Agregar a Ver");
    const combinaciones = productoCartesiano({ P: dims.P!, N: dims.N!, F: dims.F! });
    expect(tabla.filas).toHaveLength(combinaciones.length);
    for (const c of combinaciones) {
      const fila = tabla.filas.filter((f) => f.P === c.P && f.N === c.N && f.F === c.F);
      expect(fila, JSON.stringify(c)).toHaveLength(1);
      const semilla = semillaDePlantillas().listas[c.P as PlantillaConLista];
      const ver = [...semilla.ver, X];
      expect(primera(incumplimientosDeLaPlantilla(c.P!, ver, ver, pisosCon(c.F!), catalogoCon(c.N!, "NO"))), JSON.stringify(c)).toBe(fila[0]!.Resultado);
    }
  });

  it("«Quitar»: el producto cartesiano P × N × F × A coincide fila por fila con el oráculo (la lista RESULTANTE no lleva la acción)", () => {
    const tabla = tablaDelOraculoDePlantillas("Quitar de Ver y Editar");
    const combinaciones = productoCartesiano({ P: dims.P!, N: dims.N!, F: dims.F!, A: dims.A! });
    expect(tabla.filas).toHaveLength(combinaciones.length);
    for (const c of combinaciones) {
      const fila = tabla.filas.filter((f) => f.P === c.P && f.N === c.N && f.F === c.F && f.A === c.A);
      expect(fila, JSON.stringify(c)).toHaveLength(1);
      const semilla = semillaDePlantillas().listas[c.P as PlantillaConLista];
      // El administrador que «conserva» la acción sintética la tendría en su lista de partida: al quitarla queda la lista de la semilla SIN ella.
      expect(primera(incumplimientosDeLaPlantilla(c.P!, semilla.ver, semilla.editar, pisosCon(c.F!), catalogoCon(c.N!, c.A!))), JSON.stringify(c)).toBe(fila[0]!.Resultado);
    }
  });

  it("«Piso inicial por nivel»: coincide con `PISO_INICIAL_POR_NIVEL`", () => {
    const tabla = tablaDelOraculoDePlantillas("Piso inicial por nivel");
    expect(tabla.filas).toHaveLength(Object.keys(PISO_INICIAL_POR_NIVEL).length);
    for (const f of tabla.filas) expect(PISO_INICIAL_POR_NIVEL[f.N as NivelDeAccion] ?? "SIN_PISO", f.N).toBe(f["Piso inicial"]);
  });
});
