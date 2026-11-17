import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, ACCIONES_QUE_DA_SOLO_EL_GERENTE, type AccionSemilla } from "../../src/core/permisos/acciones";
import { dimensionesDelOraculo, tablaDelOraculo } from "../setup/oraculo-una-sola-compra";

/**
 * Guardián de las combinaciones de PISOS-65 (regla «Combinaciones» del dueño, 2026-10-28): falla si aparece una dimensión nueva sin declarar si afecta o no. Lee el oráculo
 * `docs/oraculo-combinaciones-pisos-65-2026-11-17.md` (escrito aparte del código) y exige que:
 *  (a) las clases de acción que se deducen del catálogo (piso, semilla y lista del gerente) sean EXACTAMENTE los valores de la dimensión C;
 *  (b) los pisos presentes en el catálogo sean un subconjunto de {operario, administrador_sistema, gerente}: una clave nueva de piso «administrador» obliga a declarar su clase;
 *  (c) cada propiedad de `AccionSemilla` figure en el oráculo como «cambia» o «no cambia» (una propiedad nueva obliga a decidirlo; el tipo `Record<keyof AccionSemilla, …>` lo hace cumplir al compilar).
 */
const TEXTO = readFileSync(join(__dirname, "../../docs/oraculo-combinaciones-pisos-65-2026-11-17.md"), "utf8");
const DIMENSIONES = dimensionesDelOraculo(TEXTO);

/** Las propiedades de una acción, declaradas a mano: sumar una a `AccionSemilla` no compila hasta que figure acá. */
const PROPIEDADES = { clave: true, modulo: true, descripcion: true, contexto: true, nivelMinimo: true, rolesEditarSemilla: true, soloVer: true, reservada: true } as const satisfies Record<keyof AccionSemilla, true>;

function claseDe(a: { clave: string; nivelMinimo: string; rolesEditarSemilla: readonly string[] }): string {
  if (a.nivelMinimo === "administrador_sistema") return "GS";
  if (a.nivelMinimo === "gerente") return "GG";
  if (a.nivelMinimo !== "operario") return `piso ${a.nivelMinimo} sin declarar`;
  const semilla = [...a.rolesEditarSemilla].sort().join(",");
  if (semilla === "admin,operador") return "L";
  if (semilla === "admin") return (ACCIONES_QUE_DA_SOLO_EL_GERENTE as readonly string[]).includes(a.clave) ? "D" : "O";
  return `semilla [${semilla}] sin declarar`;
}

describe("guardián PISOS-65: las dimensiones del oráculo están declaradas", () => {
  it("(a) las clases que se deducen del catálogo son exactamente los valores de la dimensión C", () => {
    const deducidas = new Set(ACCIONES.map((a) => claseDe(a)));
    expect([...deducidas].sort()).toEqual([...(DIMENSIONES["C"] ?? [])].sort());
  });

  it("(b) los pisos del catálogo son un subconjunto de {operario, administrador_sistema, gerente}", () => {
    const presentes = new Set<string>(ACCIONES.map((a) => a.nivelMinimo as string));
    for (const piso of presentes) expect(["operario", "administrador_sistema", "gerente"], `una clave de piso «${piso}» obliga a declarar su clase en el oráculo`).toContain(piso);
  });

  it("(c) cada propiedad de AccionSemilla figura en el oráculo como «cambia» o «no cambia», y ninguna sobra", () => {
    const declaradas = tablaDelOraculo("Propiedades de una acción", TEXTO).filas;
    expect(declaradas.map((f) => f["Propiedad"]).sort()).toEqual(Object.keys(PROPIEDADES).sort());
    for (const f of declaradas) expect(["cambia", "no cambia"], String(f["Propiedad"])).toContain(f["¿Cambia?"]);
  });

  it("(d) las dimensiones declaradas son las que el test de integración recorre", () => {
    expect(Object.keys(DIMENSIONES).sort()).toEqual(["C", "F", "M", "Q", "R"]);
    expect(DIMENSIONES["R"]).toEqual(["ADMIN", "OPERARIO"]);
    expect(DIMENSIONES["Q"]).toEqual(["GERENTE", "ADMINISTRADOR"]);
    expect(DIMENSIONES["M"]).toEqual(["OTORGA", "QUITA"]);
    expect(DIMENSIONES["F"]).toEqual(["SI", "NO"]);
  });
});
