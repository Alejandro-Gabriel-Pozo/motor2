import { describe, expect, it } from "vitest";
import { crearEmpresaSchema, esTransicionValida, transicionesValidasDesde, type ComandoCrearEmpresa, type EstadoEmpresa } from "../../src/core/features/empresa/empresa.schema";

/**
 * Fase 1.4 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): "Provisioning de empresa
 * (contrato, no automatización completa)". Confirma el schema de `crearEmpresaSchema` y la máquina de estados documentada —
 * sin ningún caso de uso real todavía (el modelo `Empresa` no existe en Prisma hasta la Fase A).
 */
describe("crearEmpresaSchema", () => {
  const base: ComandoCrearEmpresa = { nombre: "La Cuadra", slug: "la-cuadra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" };

  it("acepta la forma acordada", () => {
    expect(crearEmpresaSchema.parse(base)).toEqual(base);
  });

  it("recorta espacios del nombre, y rechaza uno vacío o demasiado largo", () => {
    expect(crearEmpresaSchema.parse({ ...base, nombre: "  La Cuadra  " }).nombre).toBe("La Cuadra");
    expect(crearEmpresaSchema.safeParse({ ...base, nombre: "" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, nombre: "x".repeat(121) }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, nombre: "x".repeat(120) }).success).toBe(true);
  });

  it("slug: solo minúsculas, dígitos y guiones — rechaza mayúsculas, espacios y guion bajo", () => {
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "La-Cuadra" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "la cuadra" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "la_cuadra" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, slug: "la-cuadra-2" }).success).toBe(true);
  });

  it("zonaHoraria: tiene que ser una zona IANA que Intl conozca — rechaza vacío, texto libre, offsets y espacios", () => {
    for (const zona of ["", "Argentina", "Buenos Aires", "-03:00", "UTC-3", " America/Argentina/Buenos_Aires", "America/Inventada"]) {
      expect(crearEmpresaSchema.safeParse({ ...base, zonaHoraria: zona }).success, zona).toBe(false);
    }
    for (const zona of ["America/Argentina/Buenos_Aires", "America/New_York", "Europe/Madrid", "UTC"]) {
      expect(crearEmpresaSchema.safeParse({ ...base, zonaHoraria: zona }).success, zona).toBe(true);
    }
  });

  it("moneda: exactamente 3 caracteres (ISO 4217) — rechaza 2 o 4", () => {
    expect(crearEmpresaSchema.safeParse({ ...base, moneda: "AR" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, moneda: "ARSS" }).success).toBe(false);
    expect(crearEmpresaSchema.safeParse({ ...base, moneda: "USD" }).success).toBe(true);
  });
});

describe("máquina de estados de Empresa (esTransicionValida/transicionesValidasDesde)", () => {
  it("DELETING es terminal — ninguna transición sale de ahí", () => {
    expect(transicionesValidasDesde("DELETING")).toEqual([]);
    const TODOS: EstadoEmpresa[] = ["PROVISIONING", "ACTIVE", "SUSPENDED", "DELETING"];
    for (const hacia of TODOS) expect(esTransicionValida("DELETING", hacia)).toBe(false);
  });

  it("PROVISIONING puede completar el alta (ACTIVE) o abortarla (DELETING), nunca ir directo a SUSPENDED", () => {
    expect(esTransicionValida("PROVISIONING", "ACTIVE")).toBe(true);
    expect(esTransicionValida("PROVISIONING", "DELETING")).toBe(true);
    expect(esTransicionValida("PROVISIONING", "SUSPENDED")).toBe(false);
  });

  it("ACTIVE y SUSPENDED se alternan libremente entre sí, y los dos pueden ir a DELETING", () => {
    expect(esTransicionValida("ACTIVE", "SUSPENDED")).toBe(true);
    expect(esTransicionValida("SUSPENDED", "ACTIVE")).toBe(true);
    expect(esTransicionValida("ACTIVE", "DELETING")).toBe(true);
    expect(esTransicionValida("SUSPENDED", "DELETING")).toBe(true);
  });

  it("ningún estado transiciona a sí mismo (no hay una arista reflexiva documentada)", () => {
    const TODOS: EstadoEmpresa[] = ["PROVISIONING", "ACTIVE", "SUSPENDED", "DELETING"];
    for (const estado of TODOS) expect(esTransicionValida(estado, estado)).toBe(false);
  });
});
