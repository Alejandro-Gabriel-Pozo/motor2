import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../cercos/trinquete";
import { MANIFIESTO } from "./manifiesto";
import { formatearAviso, formatearHallazgo, formatearReporte, resumirContratos, revisarContratos } from "./motor";
import { fechaUtcDeHoy } from "./politica";
import type { Resultado } from "./tipos";

/**
 * Guardián «contratos compartidos declarados»: corre el motor (`motor.ts`) sobre el repo real con el manifiesto (`manifiesto.ts`). Cualquier hallazgo lo pone en
 * rojo, con una línea `archivo:línea:columna  [contrato · tipo]` y qué falta y cómo se corrige (ver `LEEME.md`). Lo prueba, con árboles temporales, `motor.test.ts`.
 */
let memo: Resultado | undefined;
const resultado = (): Resultado => (memo ??= revisarContratos({ raiz: RAIZ_DEL_REPO, contratos: MANIFIESTO, hoy: fechaUtcDeHoy() }));

describe("contratos compartidos declarados (repo real)", () => {
  it("ningún uso sin declarar, ninguna definición duplicada, ninguna marca suelta, ninguna excepción ni deuda que sobre", () => {
    const r = resultado();
    // El resumen sale siempre: cuántos contratos hay y cuánta deuda declarada queda (la deuda se paga, no se acumula).
    console.info(`[contratos] ${[...r.avisos.map(formatearAviso), resumirContratos(r)].join("\n")}`);
    expect(r.hallazgos.map(formatearHallazgo), formatearReporte(r)).toEqual([]);
  });

  it("el resumen cuenta los contratos del manifiesto", () => {
    expect(resultado().resumen.contratos).toBe(MANIFIESTO.length);
    expect(resumirContratos(resultado())).toContain(`${MANIFIESTO.length} contratos`);
  });
});
