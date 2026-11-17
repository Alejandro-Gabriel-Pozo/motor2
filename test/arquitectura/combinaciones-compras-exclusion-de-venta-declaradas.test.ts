import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EFECTO_DE_USO_EN_LA_VENTA, USOS_DE_SECCION, USOS_QUE_SIRVEN_PARA_VENDER, usoSirveParaVender } from "@/core/compras/public";
import { dimensionesDeExclusionDeVenta, tablaDeExclusionDeVenta } from "../setup/oraculo-compras-exclusion-de-venta";

/**
 * GUARDIÁN de la exclusión de depósitos especiales en la venta (etapa (ii-a); regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-exclusion-de-venta-2026-11-17.md` declara, para cada uso de depósito, su efecto en la venta.
 * Falla si: (a) aparece un uso en el código (`USOS_DE_SECCION`) o en el CHECK de la base que el oráculo no declara en «Usos de depósito y su efecto» (o declara uno que no existe, o sin efecto); (b) lo que el oráculo dice que «sirve» o «no sirve»
 * no coincide con `EFECTO_DE_USO_EN_LA_VENTA` del código; (c) las dimensiones O, U y S no son las que el recorrido contra la base sabe armar; (d) un valor desconocido no cierra (falla cerrada).
 */
const RAIZ = join(__dirname, "../..");

describe("guardián: la venta declara el efecto de cada uso de depósito en el oráculo", () => {
  const declarados = tablaDeExclusionDeVenta("Usos de depósito y su efecto").filas.map((f) => ({ uso: (f["Uso"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(a) cada uso del código está declarado con un efecto (y ninguno declarado sobra)", () => {
    expect(declarados.map((d) => d.uso).sort()).toEqual([...USOS_DE_SECCION].sort());
    for (const { uso, efecto } of declarados) expect(efecto.length, `${uso}: sin efecto declarado`).toBeGreaterThan(10);
  });

  it("(a) los usos del CHECK de la base son exactamente los declarados", () => {
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261117126000_compras_uso_de_seccion/migration.sql"), "utf8");
    const check = /"Seccion_uso_chk" CHECK \("uso" IN \(([^)]*)\)\)/.exec(migracion);
    expect(check, "el CHECK de uso existe en la migración").not.toBeNull();
    expect([...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual(declarados.map((d) => d.uso).sort());
  });

  it("(b) lo que el oráculo dice que sirve para vender es exactamente lo que el código deja vender", () => {
    const quedicenQueSirve = declarados.filter((d) => d.efecto.startsWith("sirve para vender")).map((d) => d.uso);
    const quedicenQueNoSirve = declarados.filter((d) => d.efecto.startsWith("no sirve para vender")).map((d) => d.uso);
    expect([...quedicenQueSirve, ...quedicenQueNoSirve].sort(), "cada efecto empieza con «sirve para vender» o «no sirve para vender»").toEqual(declarados.map((d) => d.uso).sort());
    expect([...USOS_QUE_SIRVEN_PARA_VENDER].sort()).toEqual(quedicenQueSirve.sort());
    for (const uso of USOS_DE_SECCION) expect(usoSirveParaVender(uso)).toBe(EFECTO_DE_USO_EN_LA_VENTA[uso] === "SIRVE");
    expect(Object.keys(EFECTO_DE_USO_EN_LA_VENTA).sort()).toEqual([...USOS_DE_SECCION].sort());
  });

  it("(c) las dimensiones del oráculo son las que el recorrido sabe armar", () => {
    const dims = dimensionesDeExclusionDeVenta();
    expect(Object.keys(dims).sort()).toEqual(["O", "S", "U"]);
    expect(dims["O"]).toEqual(["AUTOMATICO", "MOSTRADOR", "HABITUAL"]);
    expect(dims["U"]).toEqual(["SOLO_NORMAL", "ESPECIAL_CON_STOCK", "ELEGIDA_ESPECIAL", "UNICA_CON_STOCK_ESPECIAL"]);
    expect(dims["S"]).toEqual(["ALCANZA", "NO_ALCANZA"]);
  });

  it("(d) cerrado por defecto: un valor que no es un uso declarado como «sirve» no sirve", () => {
    for (const raro of [undefined, null, "", "normal", "OTRO", 1, " NORMAL"]) expect(usoSirveParaVender(raro)).toBe(false);
  });
});
