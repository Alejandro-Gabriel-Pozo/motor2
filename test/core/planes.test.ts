import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULOS } from "../../src/core/modulos/catalogo";
import { CODIGO_DEL_PLAN_DE_TRANSICION, MODULOS_DEL_PLAN_DE_TRANSICION } from "../../src/core/features/empresa/plan-de-transicion";
import {
  PlanesError,
  asignacionVigenteEn,
  estadoDeModulosFrenteAlTecho,
  huellaCanonica,
  validarClaveDeReintento,
  validarCodigoDePlan,
  validarModulosDelPlan,
  validarMotivo,
  validarNombreComercial,
} from "../../src/core/features/empresa/planes";

/** Planes versionados (M1), parte pura: lo que se PERMITE (lista de permitidos), la huella del reintento, la vigencia calculada y el aviso de techo. */
const MIGRACION = readFileSync(join(__dirname, "../../prisma/migrations/20261117100000_planes_versionados/migration.sql"), "utf8");

describe("validaciones de un plan (lista de permitidos)", () => {
  it("el código acepta solo minúsculas, dígitos y guion, desde una letra, de 2 a 40", () => {
    for (const bueno of ["actual", "con-salon", "a1", "x".repeat(40)]) expect(validarCodigoDePlan(bueno)).toBe(bueno);
    for (const malo of ["", "a", "1abc", "Basico", "con salon", "con_salon", "x".repeat(41), "plan\n", "plän"]) expect(() => validarCodigoDePlan(malo), malo).toThrow(PlanesError);
  });

  it("la clave de reintento es un UUID en minúsculas", () => {
    expect(validarClaveDeReintento("123e4567-e89b-42d3-a456-426614174000")).toBe("123e4567-e89b-42d3-a456-426614174000");
    for (const mala of ["", "abc", "123E4567-E89B-42D3-A456-426614174000", "123e4567-e89b-42d3-a456-42661417400"]) expect(() => validarClaveDeReintento(mala), mala).toThrow(PlanesError);
  });

  it("nombre y motivo: de 1 a 80 / 500 caracteres, sin caracteres de control; se recortan", () => {
    expect(validarNombreComercial("  Con salón  ")).toBe("Con salón");
    expect(() => validarNombreComercial("   ")).toThrow(PlanesError);
    expect(() => validarNombreComercial("a\u0000b")).toThrow(PlanesError);
    expect(() => validarNombreComercial("x".repeat(81))).toThrow(PlanesError);
    expect(validarMotivo("Contrato nuevo")).toBe("Contrato nuevo");
    expect(() => validarMotivo("")).toThrow(PlanesError);
    expect(() => validarMotivo("x".repeat(501))).toThrow(PlanesError);
    expect(() => validarMotivo("con\ncontrol")).toThrow(PlanesError);
  });

  it("el techo solo admite módulos vendibles disponibles, sin repetir; sale ordenado", () => {
    expect(validarModulosDelPlan(["salon", "stock"])).toEqual(["salon", "stock"]);
    expect(validarModulosDelPlan([])).toEqual([]);
    expect(() => validarModulosDelPlan(["administracion"])).toThrow(/solo los vendibles disponibles/);
    expect(() => validarModulosDelPlan(["catalogo_basico"])).toThrow(PlanesError); // soporte
    expect(() => validarModulosDelPlan(["gastos"])).toThrow(PlanesError); // en desarrollo
    expect(() => validarModulosDelPlan(["inventado"])).toThrow(PlanesError);
    expect(() => validarModulosDelPlan(["stock", "stock"])).toThrow(/repetido/);
  });
});

describe("huella del reintento", () => {
  it("es la misma para el mismo pedido sin importar el orden de las claves, y cambia si cambia algo", () => {
    expect(huellaCanonica({ a: "1", b: ["x", "y"] })).toBe(huellaCanonica({ b: ["x", "y"], a: "1" }));
    expect(huellaCanonica({ a: "1", b: ["x", "y"] })).not.toBe(huellaCanonica({ a: "1", b: ["x"] }));
  });
});

describe("asignación vigente (se calcula, nunca se marca)", () => {
  const t = (iso: string) => new Date(iso);
  const filas = [
    { numero: 1, versionDePlanId: "v1", aplicaDesde: t("2026-01-01T00:00:00Z") },
    { numero: 3, versionDePlanId: "v3", aplicaDesde: t("2026-03-01T00:00:00Z") },
    { numero: 2, versionDePlanId: "v2", aplicaDesde: t("2026-02-01T00:00:00Z") },
  ];
  it("es la de número mayor que ya empezó", () => {
    expect(asignacionVigenteEn(filas, t("2026-02-15T00:00:00Z"))?.versionDePlanId).toBe("v2");
    expect(asignacionVigenteEn(filas, t("2026-03-01T00:00:00Z"))?.versionDePlanId).toBe("v3");
  });
  it("sin ninguna que haya empezado, no hay plan (falla cerrado)", () => {
    expect(asignacionVigenteEn(filas, t("2025-12-31T00:00:00Z"))).toBeNull();
    expect(asignacionVigenteEn([], t("2026-02-15T00:00:00Z"))).toBeNull();
  });
});

describe("estado de los módulos frente al techo del plan (aviso de M1)", () => {
  it("dentro del techo ACTIVO; fuera, SOLO_LECTURA", () => {
    expect(estadoDeModulosFrenteAlTecho(["stock", "salon", "carta"], ["stock", "carta"])).toEqual({ carta: "ACTIVO", salon: "SOLO_LECTURA", stock: "ACTIVO" });
    expect(estadoDeModulosFrenteAlTecho([], ["stock"])).toEqual({});
  });
});

describe("plan de transición (q4: «todos los módulos disponibles»)", () => {
  it("la constante son los vendibles disponibles del catálogo, y la migración trae EXACTAMENTE esa lista (si cambia una, rojo)", () => {
    const vendibles = MODULOS.filter((m) => m.tipo === "vendible" && m.estado === "disponible").map((m) => m.id as string).sort();
    expect([...MODULOS_DEL_PLAN_DE_TRANSICION]).toEqual(vendibles);
    const enLaMigracion = [...(MIGRACION.match(/ARRAY\[([^\]]+)\]/)![1].matchAll(/'([a-z_]+)'/g))].map((m) => m[1]).sort();
    expect(enLaMigracion).toEqual([...MODULOS_DEL_PLAN_DE_TRANSICION]);
    expect(MIGRACION).toContain(`'${CODIGO_DEL_PLAN_DE_TRANSICION}'`);
  });
  it("el plan de transición cumple las propias reglas de un techo", () => {
    expect(validarModulosDelPlan(MODULOS_DEL_PLAN_DE_TRANSICION)).toEqual([...MODULOS_DEL_PLAN_DE_TRANSICION]);
    expect(validarCodigoDePlan(CODIGO_DEL_PLAN_DE_TRANSICION)).toBe(CODIGO_DEL_PLAN_DE_TRANSICION);
  });
});
