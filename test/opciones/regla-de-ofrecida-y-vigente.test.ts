import { describe, expect, it } from "vitest";
import { grupoVigente, opcionOfrecida } from "@/core/opciones/public";
import { opcionDisponible } from "@/core/pos/public";

/**
 * Lote 3b: «opción ofrecida» (`activa && admitida`) y «grupo vigente» (`admitido && activo`) son UNA función cada una. Se recorren TODAS las combinaciones de los booleanos (el oráculo es la tabla
 * escrita acá, no la función) y se fija la relación con `opcionDisponible`: la disponible es la ofrecida que además no está agotada hoy en la sucursal.
 */
const BOOLEANOS = [false, true] as const;

describe("opcionOfrecida", () => {
  const TABLA: Array<[boolean, boolean, boolean]> = [
    // activa, admitida, ofrecida
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ];
  it.each(TABLA)("activa=%s, admitida=%s → ofrecida=%s", (activa, admitida, esperado) => {
    expect(opcionOfrecida({ activa, admitida })).toBe(esperado);
  });
});

describe("grupoVigente", () => {
  const TABLA: Array<[boolean, boolean, boolean]> = [
    // admitido, activo, vigente
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ];
  it.each(TABLA)("admitido=%s, activo=%s → vigente=%s", (admitido, activo, esperado) => {
    expect(grupoVigente({ admitido, activo })).toBe(esperado);
  });
});

describe("opcionDisponible = opcionOfrecida y no agotada hoy", () => {
  it("coincide en las 8 combinaciones: agotar una opción ofrecida la saca de lo disponible, y agotarla no cambia lo ofrecido", () => {
    for (const activa of BOOLEANOS) {
      for (const admitida of BOOLEANOS) {
        for (const apagadaEnSucursal of BOOLEANOS) {
          const o = { activa, admitida, apagadaEnSucursal };
          expect(opcionDisponible(o)).toBe(activa && admitida && !apagadaEnSucursal);
          expect(opcionOfrecida(o)).toBe(activa && admitida);
          expect(opcionDisponible(o)).toBe(opcionOfrecida(o) && !apagadaEnSucursal);
        }
      }
    }
  });
});
