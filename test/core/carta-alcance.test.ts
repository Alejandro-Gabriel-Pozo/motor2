import { describe, expect, it } from "vitest";
import { diferenciaDeAlcance, seVeEnSucursal, validarAlcanceItemDentroDeSeccion, validarNoAlcanceVacio } from "@/core/carta/alcance";

describe("seVeEnSucursal", () => {
  it("TODAS se ve en cualquier sucursal, incluida una que no está en la lista", () => {
    expect(seVeEnSucursal("TODAS", [], "suc-x")).toBe(true);
    expect(seVeEnSucursal("TODAS", ["suc-a"], "suc-x")).toBe(true);
  });

  it("SUCURSALES solo se ve donde está en la lista", () => {
    expect(seVeEnSucursal("SUCURSALES", ["suc-a", "suc-b"], "suc-a")).toBe(true);
    expect(seVeEnSucursal("SUCURSALES", ["suc-a", "suc-b"], "suc-x")).toBe(false);
  });
});

describe("validarAlcanceItemDentroDeSeccion", () => {
  it("cualquier alcance de ítem vale si la sección es TODAS", () => {
    const seccion = { alcance: "TODAS" as const, sucursalIds: [] };
    expect(validarAlcanceItemDentroDeSeccion(seccion, { alcance: "TODAS", sucursalIds: [] }).ok).toBe(true);
    expect(validarAlcanceItemDentroDeSeccion(seccion, { alcance: "SUCURSALES", sucursalIds: ["suc-a"] }).ok).toBe(true);
  });

  it("rechaza un ítem TODAS bajo una sección SUCURSALES", () => {
    const seccion = { alcance: "SUCURSALES" as const, sucursalIds: ["suc-a"] };
    const r = validarAlcanceItemDentroDeSeccion(seccion, { alcance: "TODAS", sucursalIds: [] });
    expect(r.ok).toBe(false);
  });

  it("acepta un ítem SUCURSALES cuyas sucursales son subconjunto de la sección", () => {
    const seccion = { alcance: "SUCURSALES" as const, sucursalIds: ["suc-a", "suc-b"] };
    const r = validarAlcanceItemDentroDeSeccion(seccion, { alcance: "SUCURSALES", sucursalIds: ["suc-a"] });
    expect(r.ok).toBe(true);
  });

  it("rechaza un ítem SUCURSALES con una sucursal fuera del alcance de su sección", () => {
    const seccion = { alcance: "SUCURSALES" as const, sucursalIds: ["suc-a"] };
    const r = validarAlcanceItemDentroDeSeccion(seccion, { alcance: "SUCURSALES", sucursalIds: ["suc-a", "suc-b"] });
    expect(r.ok).toBe(false);
  });
});

describe("validarNoAlcanceVacio", () => {
  it("rechaza una lista vacía", () => {
    expect(validarNoAlcanceVacio([]).ok).toBe(false);
  });

  it("acepta cualquier lista no vacía", () => {
    expect(validarNoAlcanceVacio(["suc-a"]).ok).toBe(true);
  });
});

describe("diferenciaDeAlcance", () => {
  it("detecta agregadas y quitadas por separado", () => {
    const { agregadas, quitadas } = diferenciaDeAlcance(["suc-a", "suc-b"], ["suc-b", "suc-c"]);
    expect(agregadas).toEqual(["suc-c"]);
    expect(quitadas).toEqual(["suc-a"]);
  });

  it("sin cambios da dos arrays vacíos", () => {
    const { agregadas, quitadas } = diferenciaDeAlcance(["suc-a"], ["suc-a"]);
    expect(agregadas).toEqual([]);
    expect(quitadas).toEqual([]);
  });
});
