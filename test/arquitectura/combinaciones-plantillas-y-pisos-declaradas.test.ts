import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, type AccionSemilla } from "../../src/core/permisos/acciones";
import { PISO_INICIAL_POR_NIVEL, PLANTILLAS, PLANTILLAS_CON_LISTA, TIPOS_DE_PISO } from "../../src/core/permisos/plantillas-y-pisos";
import { ROLES_DE_FABRICA } from "../../src/core/permisos/roles-de-fabrica";
import { dimensionesDelOraculoDePlantillas, textoDelOraculoDePlantillas } from "../setup/oraculo-plantillas-y-pisos";

/**
 * Guardián de dimensiones de plantillas y pisos (regla de combinaciones del 2026-10-28): falla si aparece una dimensión nueva (un nivel, un tipo de piso, una plantilla, una propiedad de la acción o un rol de fábrica) sin
 * declarar en `docs/oraculo-combinaciones-plantillas-y-pisos-2026-11-17.md` si cambia el resultado. Cada comparación cruza el código, el oráculo y el CHECK de la migración.
 */
const MIGRACION = readFileSync(join(__dirname, "../../prisma/migrations/20261117100400_plantillas_y_pisos/migration.sql"), "utf8");
const valoresDelCheck = (nombre: string): string[] => {
  const m = new RegExp(`CONSTRAINT "${nombre}" CHECK \\([^)]*IN \\(([^)]*)\\)`).exec(MIGRACION);
  if (!m) throw new Error(`La migración no tiene el CHECK ${nombre}.`);
  return [...m[1]!.matchAll(/'([A-Za-z_]+)'/g)].map((x) => x[1]!);
};
const ordenados = (xs: readonly string[]) => [...xs].sort();

/** Cada propiedad de una acción del catálogo declara si afecta plantillas y pisos, con su motivo. Una propiedad nueva sin declarar rompe el tipo (`Record<keyof AccionSemilla, …>`) y este test. */
const CAMPOS: Record<keyof AccionSemilla, { afecta: "semilla" | "piso" | "ninguna"; motivo: string }> = {
  clave: { afecta: "semilla", motivo: "Es lo que las listas Ver y Editar guardan." },
  modulo: { afecta: "ninguna", motivo: "Ninguna regla de plantilla ni de piso mira el módulo." },
  descripcion: { afecta: "ninguna", motivo: "Es texto de pantalla." },
  contexto: { afecta: "ninguna", motivo: "Ninguna regla de plantilla ni de piso mira el contexto." },
  nivelMinimo: { afecta: "piso", motivo: "Define el piso inicial (PISO_INICIAL_POR_NIVEL) y la regla transitoria de nivel." },
  rolesEditarSemilla: { afecta: "semilla", motivo: "Define qué acciones lleva la versión 1 de cada plantilla (Ver = Editar)." },
  soloVer: { afecta: "ninguna", motivo: "La plantilla guarda Ver y Editar aparte; el oráculo declara que no cambia el resultado." },
  reservada: { afecta: "ninguna", motivo: "Una acción reservada igual figura en el catálogo y en la semilla." },
};

describe("dimensiones de plantillas y pisos declaradas", () => {
  const dims = dimensionesDelOraculoDePlantillas();

  it("(a) los niveles de las acciones y las claves de PISO_INICIAL_POR_NIVEL son exactamente la dimensión N del oráculo", () => {
    expect(ordenados([...new Set(ACCIONES.map((a) => a.nivelMinimo))])).toEqual(ordenados(dims.N!));
    expect(ordenados(Object.keys(PISO_INICIAL_POR_NIVEL))).toEqual(ordenados(dims.N!));
  });

  it("(b) los tipos de piso del código = la dimensión F del oráculo (más «SIN_PISO») = el CHECK de la migración", () => {
    expect(ordenados([...TIPOS_DE_PISO, "SIN_PISO"])).toEqual(ordenados(dims.F!));
    expect(ordenados(valoresDelCheck("PisoDePlataforma_tipo_check"))).toEqual(ordenados(TIPOS_DE_PISO));
  });

  it("(c) las plantillas del código = la dimensión P del oráculo (más GERENTE, que se rechaza siempre) = el CHECK de la migración", () => {
    expect(ordenados(PLANTILLAS_CON_LISTA)).toEqual(ordenados(dims.P!));
    expect(ordenados(PLANTILLAS)).toEqual(ordenados([...dims.P!, "GERENTE"]));
    expect(ordenados(valoresDelCheck("PlantillaDeRol_clave_check"))).toEqual(ordenados(PLANTILLAS));
    expect(ordenados(valoresDelCheck("VersionDePlantilla_plantilla_check"))).toEqual(ordenados(PLANTILLAS_CON_LISTA));
  });

  it("(d) toda propiedad de una acción está declarada en CAMPOS con su motivo, y las que no afectan figuran en el oráculo como «no cambian»", () => {
    const presentes = new Set(ACCIONES.flatMap((a) => Object.keys(a)));
    expect(ordenados([...presentes].filter((p) => !(p in CAMPOS)))).toEqual([]);
    for (const [campo, d] of Object.entries(CAMPOS)) expect(d.motivo.length, campo).toBeGreaterThan(10);
    const texto = textoDelOraculoDePlantillas();
    for (const [campo, d] of Object.entries(CAMPOS)) {
      if (d.afecta === "ninguna" && campo !== "clave") expect(texto.includes(campo === "descripcion" ? "descripción" : campo === "modulo" ? "módulo" : campo), `${campo} tiene que figurar en el oráculo`).toBe(true);
    }
  });

  it("(e) los roles de fábrica siguen siendo exactamente admin y operador (los que las plantillas ADMINISTRADOR y OPERADOR representan)", () => {
    expect(ROLES_DE_FABRICA.map((r) => r.nombre)).toEqual(["admin", "operador"]);
  });
});
