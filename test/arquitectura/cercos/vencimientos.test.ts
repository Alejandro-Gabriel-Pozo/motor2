import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fechaUtcDeHoy } from "../contratos/politica";
import { leerListasDeDeuda, revisarVencimientos, VENCIMIENTOS_DE_LISTAS, type ListaDeDeuda, type VencimientoDeLista } from "./vencimientos";

/**
 * Toda deuda de los cercos tiene fecha (regla G1b, 60 días): el test real cruza `linea-de-base/*.json` con `VENCIMIENTOS_DE_LISTAS` y el reloj del sistema; los demás ejercen la función con
 * listas, registros y «hoy» inyectados, para probar que el mecanismo detecta lo que dice (vencida, sin fecha, excedida, sobrante).
 */
const base = (extra: Partial<VencimientoDeLista> = {}): VencimientoDeLista => ({
  regla: "a",
  inicio: "2026-11-06",
  vence: "2026-12-04",
  responsable: "dueño",
  aprobacion: { por: "dueño", referencia: "PR #165" },
  motivo: "Un motivo escrito de más de veinte caracteres.",
  ...extra,
});
const listas: ListaDeDeuda[] = [
  { regla: "a", entradas: 3 },
  { regla: "b", entradas: 0 },
];

describe("deuda de los cercos con fecha", () => {
  it("el repo real: toda lista con entradas tiene fecha vigente (y avisa las que vencen en 14 días o menos)", () => {
    const { problemas, avisos } = revisarVencimientos(leerListasDeDeuda(join(__dirname, "linea-de-base")), VENCIMIENTOS_DE_LISTAS, fechaUtcDeHoy());
    for (const aviso of avisos) console.warn(`[deuda de los cercos] ${aviso}`);
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("las fechas del registro real están escalonadas (no todas el mismo día) y dentro de los 60 días", () => {
    const fechas = VENCIMIENTOS_DE_LISTAS.map((v) => v.vence);
    expect(new Set(fechas).size).toBe(fechas.length);
    expect(revisarVencimientos(VENCIMIENTOS_DE_LISTAS.map((v) => ({ regla: v.regla, entradas: 1 })), VENCIMIENTOS_DE_LISTAS, "2026-11-12").problemas).toEqual([]);
  });

  it("verde con fecha vigente; vence hoy sigue vigente", () => {
    expect(revisarVencimientos(listas, [base()], "2026-11-06").problemas).toEqual([]);
    expect(revisarVencimientos(listas, [base()], "2026-12-04").problemas).toEqual([]);
  });

  it("vencida (vence ayer) → falla y dice cómo arreglarlo", () => {
    const { problemas } = revisarVencimientos(listas, [base()], "2026-12-05");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("VENCIÓ el 2026-12-04");
    expect(problemas[0]).toContain("renovala");
  });

  it("lista con entradas y sin fecha → falla (deuda nueva sin fecha)", () => {
    const { problemas } = revisarVencimientos([...listas, { regla: "c", entradas: 1 }], [base()], "2026-11-06");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("«c»");
    expect(problemas[0]).toContain("NO tiene fecha");
  });

  it("fecha a más de 60 días de su inicio → falla", () => {
    expect(revisarVencimientos(listas, [base({ vence: "2027-01-05" })], "2026-11-06").problemas).toEqual([]);
    expect(revisarVencimientos(listas, [base({ vence: "2027-01-06" })], "2026-11-06").problemas[0]).toContain("más de 60 días");
  });

  it("registro que sobra (lista en 0, lista inexistente o repetida) → falla", () => {
    expect(revisarVencimientos(listas, [base(), base({ regla: "b" })], "2026-11-06").problemas[0]).toContain("ya está en 0");
    expect(revisarVencimientos(listas, [base(), base({ regla: "z" })], "2026-11-06").problemas[0]).toContain("no existe esa lista");
    expect(revisarVencimientos(listas, [base(), base()], "2026-11-06").problemas[0]).toContain("repetido");
  });

  it("fecha inválida, motivo corto o aprobación sin referencia → falla", () => {
    expect(revisarVencimientos(listas, [base({ vence: "2026-02-30" })], "2026-11-06").problemas[0]).toContain("fechas AAAA-MM-DD reales");
    expect(revisarVencimientos(listas, [base({ motivo: "corto" })], "2026-11-06").problemas[0]).toContain("motivo");
    expect(revisarVencimientos(listas, [base({ aprobacion: { por: "dueño", referencia: "cualquiera" } })], "2026-11-06").problemas[0]).toContain("aprobación");
  });

  it("a 14 días o menos avisa sin fallar; a 15 no avisa", () => {
    const cerca = revisarVencimientos(listas, [base()], "2026-11-20");
    expect(cerca.problemas).toEqual([]);
    expect(cerca.avisos).toHaveLength(1);
    expect(revisarVencimientos(listas, [base()], "2026-11-19").avisos).toEqual([]);
  });
});
