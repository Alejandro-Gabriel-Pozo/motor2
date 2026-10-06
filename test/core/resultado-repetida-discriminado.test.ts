import { describe, expect, expectTypeOf, it } from "vitest";
import type { DatosRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.schema";
import type { DatosReclasificarStock } from "../../src/core/features/movimientos/reclasificacion.schema";
import type { DatosRegistrarPagoConsignante } from "../../src/core/features/reportes/pago-consignante.schema";
import type { DatosRegistrarConteoFisico } from "../../src/core/features/movimientos/conteo-fisico.schema";

/**
 * `DatosRegistrarMovimiento`/`DatosReclasificarStock`/`DatosRegistrarPagoConsignante` (backlog post-cierre de Task #41, 2026-09-28,
 * docs/pendientes-sesion-2026-09-27.md §3): antes de esta unión discriminada, cada uno era una interfaz con los campos de datos
 * independientemente nullable y `repetida`/`repetido: boolean` suelto — `{ operacionId: "x", movimientos: 5, repetida: true }` tipaba
 * bien aunque fuera una combinación imposible (el camino de idempotencia "duplicado" nunca vuelve a escribir nada, así que sus campos
 * de datos SIEMPRE son `null`). Estos `@ts-expect-error` demuestran que la combinación imposible ya no compila — los chequea
 * `npx tsc --noEmit` (incluye `test/**`, mismo criterio que test/core/resultado-caso.test.ts), no Vitest en runtime.
 */
describe("Datos*: repetida/repetido discrimina — los campos de datos no pueden llevar valor real cuando es un resultado repetido", () => {
  it("registrarMovimiento: las dos combinaciones válidas compilan, la contradictoria no", () => {
    const repetida: DatosRegistrarMovimiento = { repetida: true, operacionId: null, movimientos: null };
    const nueva: DatosRegistrarMovimiento = { repetida: false, operacionId: "op-1", movimientos: 3 };
    // @ts-expect-error — repetida:true no puede llevar operacionId/movimientos reales.
    const imposible: DatosRegistrarMovimiento = { repetida: true, operacionId: "op-1", movimientos: 3 };
    expect([repetida, nueva, imposible]).toHaveLength(3);

    if (nueva.repetida === false) expectTypeOf(nueva.operacionId).toEqualTypeOf<string>();
    if (repetida.repetida === true) expectTypeOf(repetida.operacionId).toEqualTypeOf<null>();
  });

  it("reclasificarStock: las dos combinaciones válidas compilan, la contradictoria no", () => {
    const repetida: DatosReclasificarStock = { repetida: true, operacionId: null, disponible: null, destinosCantidad: null };
    const nueva: DatosReclasificarStock = { repetida: false, operacionId: "op-1", disponible: 5, destinosCantidad: 2 };
    // @ts-expect-error — repetida:true no puede llevar disponible/destinosCantidad reales.
    const imposible: DatosReclasificarStock = { repetida: true, operacionId: null, disponible: 5, destinosCantidad: 2 };
    expect([repetida, nueva, imposible]).toHaveLength(3);

    if (nueva.repetida === false) expectTypeOf(nueva.disponible).toEqualTypeOf<number>();
  });

  it("registrarPagoConsignante: las dos combinaciones válidas compilan, la contradictoria no", () => {
    const repetido: DatosRegistrarPagoConsignante = { repetido: true, pagoId: null };
    const nuevo: DatosRegistrarPagoConsignante = { repetido: false, pagoId: "pago-1" };
    // @ts-expect-error — repetido:true no puede llevar pagoId real.
    const imposible: DatosRegistrarPagoConsignante = { repetido: true, pagoId: "pago-1" };
    expect([repetido, nuevo, imposible]).toHaveLength(3);

    if (nuevo.repetido === false) expectTypeOf(nuevo.pagoId).toEqualTypeOf<string>();
  });

  it("registrarConteoFisico: las dos combinaciones válidas compilan, la contradictoria no", () => {
    const repetido: DatosRegistrarConteoFisico = { repetido: true, conteoId: null, diferencia: null, ajustado: null };
    const nuevo: DatosRegistrarConteoFisico = { repetido: false, conteoId: "conteo-1", diferencia: -3, ajustado: true };
    // @ts-expect-error — repetido:true no puede llevar conteoId/diferencia/ajustado reales.
    const imposible: DatosRegistrarConteoFisico = { repetido: true, conteoId: "conteo-1", diferencia: -3, ajustado: true };
    expect([repetido, nuevo, imposible]).toHaveLength(3);

    if (nuevo.repetido === false) expectTypeOf(nuevo.conteoId).toEqualTypeOf<string>();
  });
});
