import { describe, expect, expectTypeOf, it } from "vitest";
import { aResultadoAccion, exito, fracaso, type ResultadoCaso } from "../../src/core/resultado-caso";
import type { ResultadoAccion } from "../../src/server/actions/tipos";

/**
 * `ResultadoCaso` (src/core/resultado-caso.ts, Task #41 Fase M) y su traducción al `ResultadoAccion` que ya lee la UI.
 *
 * Los `expectTypeOf` NO se evalúan en tiempo de ejecución (Vitest los deja pasar sin `--typecheck`): los chequea `npx tsc --noEmit`,
 * que incluye `test/**` (tsconfig.json) y es parte obligatoria del gate. Si `aResultadoAccion` dejara de devolver EXACTAMENTE la forma
 * de `ResultadoAccion` (le sobrara `datos`/`codigo`, o le faltara algo), `tsc` falla acá.
 */
type Probe = ResultadoCaso<{ id: string }, "NO_ENCONTRADA" | "CONFLICTO">;

describe("ResultadoCaso", () => {
  it("exito y fracaso arman cada rama", () => {
    expect(exito("Listo.", { id: "x" })).toEqual({ ok: true, mensaje: "Listo.", datos: { id: "x" } });
    expect(fracaso("NO_ENCONTRADA", "No está.")).toStrictEqual({ ok: false, codigo: "NO_ENCONTRADA", mensaje: "No está." });
    expect(fracaso("ENTRADA_INVALIDA", "Revisá.", { nombre: "Falta." })).toEqual({
      ok: false,
      codigo: "ENTRADA_INVALIDA",
      mensaje: "Revisá.",
      erroresPorCampo: { nombre: "Falta." },
    });
  });

  it("exito y fracaso son asignables a un ResultadoCaso sin cast (y un código fuera de la unión no)", () => {
    const a: Probe = exito("ok", { id: "1" });
    const b: Probe = fracaso("CONFLICTO", "no");
    // @ts-expect-error — "OTRO" no está en la unión de códigos de Probe.
    const c: Probe = fracaso("OTRO", "no");
    expect([a.ok, b.ok, c.ok]).toEqual([true, false, false]);
  });

  it("aResultadoAccion deja SOLO ok y mensaje: datos, codigo y erroresPorCampo no pasan", () => {
    expect(aResultadoAccion(exito("Compra anulada.", { id: "secreto" }))).toStrictEqual({ ok: true, mensaje: "Compra anulada." });
    expect(aResultadoAccion(fracaso("NO_ENCONTRADA", "No se encontró.", { id: "x" }))).toStrictEqual({ ok: false, mensaje: "No se encontró." });
    expect(Object.keys(aResultadoAccion(exito("m", { id: "1" }))).sort()).toEqual(["mensaje", "ok"]);
  });

  it("aResultadoAccion devuelve EXACTAMENTE la forma de ResultadoAccion (src/server/actions/tipos.ts) — chequeado por tsc", () => {
    const r: Probe = exito("m", { id: "1" });
    expectTypeOf(aResultadoAccion(r)).toEqualTypeOf<ResultadoAccion>();
    // Y nada de lo que se descarta es accesible en el resultado traducido.
    expectTypeOf(aResultadoAccion(r)).not.toHaveProperty("datos");
    expectTypeOf(aResultadoAccion(r)).not.toHaveProperty("codigo");
  });
});
