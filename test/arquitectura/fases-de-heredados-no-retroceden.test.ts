import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUREZA_HEREDADA_DEL_NUCLEO } from "./pureza-heredada-del-nucleo";

/**
 * La fase que limpia un archivo heredado NO retrocede (Pureza, auditoría de la Fase 4: durante cuatro PR seguidos #84 a #87 el `base.ts` de `core/auth/` volvió de la «Fase 6» a la «Fase 4» por una
 * resolución de conflictos, y nada lo vio: las dos fases son válidas para `pureza-del-nucleo.test.ts`). `base.ts` es lo más sensible de la fase: se mueve UNA sola vez, a `server/sesion`, en
 * la Fase 6 (D-4 del plan de la Fase 4). Hecho en la Fase 6, tramo 6a: salió de la lista junto con contexto, ir-al-login, rol-de-ejecucion y session.
 *
 * `FASE_REGISTRADA` guarda la fase de cada heredado tal como quedó acordada. Una entrada puede ADELANTARSE a una fase posterior (de la 4 a la 6) sin tocar nada; no puede volver a una
 * fase anterior a la registrada. Una entrada que sale de la lista (porque se la limpió) deja de importar; una entrada nueva la frena la regla «lo nuevo nace puro» y el tope de la lista.
 * Para cambiar una fase a propósito, se cambia acá en el mismo commit y se explica en el mensaje.
 */
const FASE_REGISTRADA: Record<string, 4 | 6> = {};

/** El número de la fase con la que empieza el `pendiente` de una entrada («Fase 6: …»), o `null` si no empieza así. */
export function faseDe(pendiente: string): number | null {
  const m = /^Fase (\d+)/.exec(pendiente);
  return m ? Number(m[1]) : null;
}

/** Las entradas cuya fase actual es anterior a la registrada. */
export function retrocesos(actual: Record<string, { pendiente: string }>, registrada: Record<string, number>): string[] {
  return Object.entries(registrada)
    .filter(([ruta]) => ruta in actual)
    .filter(([ruta, fase]) => (faseDe(actual[ruta].pendiente) ?? 0) < fase)
    .map(([ruta, fase]) => `${ruta}: estaba en la Fase ${fase} y ahora dice «${actual[ruta].pendiente.slice(0, 40)}…»`);
}

describe("la fase de un heredado no retrocede", () => {
  it("el detector ve un retroceso, no un adelanto ni una entrada que salió", () => {
    expect(retrocesos({ a: { pendiente: "Fase 4: x" } }, { a: 6 })).toHaveLength(1);
    expect(retrocesos({ a: { pendiente: "Fase 6: x" } }, { a: 4 })).toEqual([]);
    expect(retrocesos({ a: { pendiente: "Fase 6: x" } }, { a: 6 })).toEqual([]);
    expect(retrocesos({}, { a: 6 })).toEqual([]);
    expect(retrocesos({ a: { pendiente: "sin fase" } }, { a: 4 })).toHaveLength(1);
  });

  it("ningún heredado del núcleo volvió a una fase anterior a la acordada", () => {
    const problemas = retrocesos(PUREZA_HEREDADA_DEL_NUCLEO, FASE_REGISTRADA);
    expect(problemas, `La fase de un heredado no retrocede (D-4: base.ts se mudó UNA vez, en la Fase 6):\n${problemas.join("\n")}`).toEqual([]);
  });

  it("toda entrada de la lista tiene una fase registrada (una entrada nueva se registra acá, con su motivo en el commit)", () => {
    const sinRegistrar = Object.keys(PUREZA_HEREDADA_DEL_NUCLEO).filter((ruta) => !(ruta in FASE_REGISTRADA));
    expect(sinRegistrar, `Registrá la fase de estos heredados en FASE_REGISTRADA:\n${sinRegistrar.join("\n")}`).toEqual([]);
  });

  it("base.ts ya salió del núcleo, UNA vez, a server/sesion (D-4; Fase 6, tramo 6a): ninguna entrada de la lista es de la sesión", () => {
    expect(Object.keys(PUREZA_HEREDADA_DEL_NUCLEO).filter((ruta) => ruta.startsWith("src/core/auth/"))).toEqual([]);
    expect(existsSync(join(__dirname, "../../src/server/sesion/base.ts"))).toBe(true);
  });

  it("la Fase 6 terminó con los heredados del núcleo (tramo 6b): la lista y su registro quedaron vacíos y así siguen", () => {
    expect(Object.keys(PUREZA_HEREDADA_DEL_NUCLEO)).toEqual([]);
    expect(Object.keys(FASE_REGISTRADA)).toEqual([]);
  });
});
