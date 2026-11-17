import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDICIONES_DE_CONTROL, ETIQUETA_DE_USO_DE_SECCION, USOS_DE_SECCION, USO_PROPUESTO_POR_CONTROL } from "@/core/compras/public";
import type { LineaParaElDestino, SeccionParaElDestino } from "@/core/compras/public";
import { dimensionesDeCuarentenaYRechazo, tablaDeCuarentenaYRechazo } from "../setup/oraculo-compras-cuarentena-y-rechazo";

/**
 * GUARDIÁN de dimensiones nuevas de los depósitos de uso RECHAZO y CUARENTENA (regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md` declara las dimensiones y, para cada uso de
 * depósito y para cada entrada de la regla de destinos, su efecto. Falla si:
 *  (a) aparece un USO de depósito en el código (`USOS_DE_SECCION`) o en el CHECK de la base que el oráculo no declara en «Usos de depósito y su efecto» (o el oráculo declara uno que ya no existe, o lo declara sin efecto);
 *  (b) las condiciones de control del código (más SIN_CONTROL) no son los valores declarados de la dimensión K, o alguna no tiene un uso propuesto;
 *  (c) la regla de destinos tiene una entrada o un campo que el oráculo no declara (los tipos obligan a sumarlo acá: `tsc` se pone rojo), o una declarada que sobra, o «afecta» una dimensión que el oráculo no define, o «no afecta» sin motivo;
 *  (d) cada uso tiene su etiqueta y sus valores son los declarados en la dimensión U (cantidad de depósitos especiales).
 */
const DIMENSIONES = dimensionesDeCuarentenaYRechazo();
const RAIZ = join(__dirname, "../..");

/** Todos los campos de lo que recibe la regla de destinos, como objeto: agregar uno al tipo sin sumarlo acá no compila. */
const ENTRADAS: Record<"lineas" | "secciones" | "elegidas" | keyof LineaParaElDestino | keyof SeccionParaElDestino | "seccionId", true> = {
  lineas: true,
  secciones: true,
  elegidas: true,
  renglonId: true,
  condicion: true,
  id: true,
  nombre: true,
  uso: true,
  activa: true,
  seccionId: true,
};

describe("guardián: los depósitos de uso especial declaran todas sus dimensiones en el oráculo", () => {
  const usosDeclarados = tablaDeCuarentenaYRechazo("Usos de depósito y su efecto").filas.map((f) => ({ uso: (f["Uso"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));
  const entradasDeclaradas = tablaDeCuarentenaYRechazo("Entradas de la regla de destinos y su efecto").filas.map((f) => ({ entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(a) cada uso del código está declarado con un efecto (y ninguno declarado sobra)", () => {
    expect(usosDeclarados.map((u) => u.uso).sort()).toEqual([...USOS_DE_SECCION].sort());
    for (const { uso, efecto } of usosDeclarados) expect(efecto.length, `${uso}: sin efecto declarado`).toBeGreaterThan(10);
  });

  it("(a) los usos del CHECK de la base son exactamente los del código", () => {
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261117126000_compras_uso_de_seccion/migration.sql"), "utf8");
    const check = /"Seccion_uso_chk" CHECK \("uso" IN \(([^)]*)\)\)/.exec(migracion);
    expect(check, "el CHECK de uso existe en la migración").not.toBeNull();
    expect([...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...USOS_DE_SECCION].sort());
    expect(/DEFAULT 'NORMAL'/.test(migracion), "los depósitos que ya existen quedan NORMAL").toBe(true);
  });

  it("(b) la dimensión K es SIN_CONTROL más las condiciones del código, y cada una propone un uso del código", () => {
    expect((DIMENSIONES["K"] ?? []).sort()).toEqual(["SIN_CONTROL", ...CONDICIONES_DE_CONTROL].sort());
    expect(Object.keys(USO_PROPUESTO_POR_CONTROL).sort()).toEqual((DIMENSIONES["K"] ?? []).sort());
    for (const uso of Object.values(USO_PROPUESTO_POR_CONTROL)) expect(USOS_DE_SECCION).toContain(uso);
  });

  it("(c) cada entrada de la regla de destinos está declarada (y ninguna declarada sobra)", () => {
    expect(entradasDeclaradas.map((d) => d.entrada).sort()).toEqual(Object.keys(ENTRADAS).sort());
  });

  it("(c) cada declaración es una dimensión definida o «no afecta» con motivo", () => {
    for (const { entrada, efecto } of entradasDeclaradas) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${entrada}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${entrada}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(d) cada uso tiene su etiqueta y las dimensiones U, X y M son las que el oráculo da por ciertas", () => {
    expect(Object.keys(ETIQUETA_DE_USO_DE_SECCION).sort()).toEqual([...USOS_DE_SECCION].sort());
    expect(DIMENSIONES["U"]).toEqual(["NINGUNA", "UNA", "VARIAS"]);
    expect(DIMENSIONES["X"]).toEqual(["PROPUESTA", "OTRA_NORMAL", "OTRA_ESPECIAL"]);
    expect(DIMENSIONES["M"]).toEqual(["APAGADO", "ENCENDIDO"]);
  });
});
