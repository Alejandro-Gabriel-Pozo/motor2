import { describe, expect, it } from "vitest";
import {
  anclasValidasEnVentana,
  clavePar,
  consumoRealDelTramo,
  cuentaComoConsumoDeReceta,
  elegirAnclas,
  esAnclaValida,
  finDelDiaUtc,
  limitesDelTramo,
  type CandidatoAncla,
} from "../../src/core/reportes/rendimiento-conciliado";

describe("cuentaComoConsumoDeReceta (D2 — qué proceso cuenta como consumo real de la receta)", () => {
  it("CONTROL siempre cuenta — es la propia medición del Conteo Físico", () => {
    expect(cuentaComoConsumoDeReceta("CONTROL", "CONTROL")).toBe(true);
  });

  it("AJUSTE cuenta (la reversión de una anulación ya se filtró en la query, antes de llegar acá)", () => {
    expect(cuentaComoConsumoDeReceta("AJUSTE", "AJUSTE")).toBe(true);
  });

  it("CONSUMO cuenta cuando lo generó una VENTA", () => {
    expect(cuentaComoConsumoDeReceta("CONSUMO", "VENTA")).toBe(true);
  });

  it("CONSUMO cuenta cuando lo generó una PRODUCCION", () => {
    expect(cuentaComoConsumoDeReceta("CONSUMO", "PRODUCCION")).toBe(true);
  });

  it("CONSUMO MANUAL (Operacion.proceso === 'CONSUMO', con Destino) NO cuenta — eso lo mide /reportes/perdidas aparte", () => {
    expect(cuentaComoConsumoDeReceta("CONSUMO", "CONSUMO")).toBe(false);
  });

  it("MERMA nunca cuenta — pérdida, cubierta por /reportes/perdidas", () => {
    expect(cuentaComoConsumoDeReceta("MERMA", "MERMA")).toBe(false);
  });

  it("TRANSFERENCIA_SALIDA_SUCURSAL / ENTRADA_SUCURSAL / REINGRESO nunca cuentan — mueven stock, no lo consumen", () => {
    expect(cuentaComoConsumoDeReceta("TRANSFERENCIA_SALIDA_SUCURSAL", "TRANSFERENCIA_SALIDA_SUCURSAL")).toBe(false);
    expect(cuentaComoConsumoDeReceta("TRANSFERENCIA_ENTRADA_SUCURSAL", "TRANSFERENCIA_ENTRADA_SUCURSAL")).toBe(false);
    expect(cuentaComoConsumoDeReceta("REINGRESO_TRANSFERENCIA_SUCURSAL", "REINGRESO_TRANSFERENCIA_SUCURSAL")).toBe(false);
  });

  it("TRANSFERENCIA (intra-sucursal), DEVOLUCION_PROVEEDOR, DEVOLUCION_CONSIGNACION, LIQUIDACION_CONSIGNACION y RECLASIFICACION nunca cuentan", () => {
    expect(cuentaComoConsumoDeReceta("TRANSFERENCIA", "TRANSFERENCIA")).toBe(false);
    expect(cuentaComoConsumoDeReceta("DEVOLUCION_PROVEEDOR", "DEVOLUCION_PROVEEDOR")).toBe(false);
    expect(cuentaComoConsumoDeReceta("DEVOLUCION_CONSIGNACION", "DEVOLUCION_CONSIGNACION")).toBe(false);
    expect(cuentaComoConsumoDeReceta("LIQUIDACION_CONSIGNACION", "PRODUCCION")).toBe(false);
    expect(cuentaComoConsumoDeReceta("RECLASIFICACION", "RECLASIFICACION")).toBe(false);
  });

  it("COMPRA y PRODUCCION (las ENTRADAS, no lo que consumen) nunca cuentan como consumo", () => {
    expect(cuentaComoConsumoDeReceta("COMPRA", "COMPRA")).toBe(false);
    expect(cuentaComoConsumoDeReceta("PRODUCCION", "PRODUCCION")).toBe(false);
  });
});

describe("consumoRealDelTramo (escenarios A-E del plan, a nivel puro)", () => {
  it("escenario A (acopio real, conteo confirma): solo la venta consume — 63", () => {
    const consumoReal = consumoRealDelTramo([{ procesoMovimiento: "CONSUMO", procesoOperacion: "VENTA", cantidad: -63 }]);
    expect(consumoReal).toBe(63);
  });

  it("escenario B (faltan 9, un CONTROL de -9 los corrige): venta + control — 72", () => {
    const consumoReal = consumoRealDelTramo([
      { procesoMovimiento: "CONSUMO", procesoOperacion: "VENTA", cantidad: -63 },
      { procesoMovimiento: "CONTROL", procesoOperacion: "CONTROL", cantidad: -9 },
    ]);
    expect(consumoReal).toBe(72);
  });

  it("escenario E (traspaso saliente de 40, filtrado — nunca cuenta): solo la venta consume, el traspaso no suma nada", () => {
    const consumoReal = consumoRealDelTramo([
      { procesoMovimiento: "CONSUMO", procesoOperacion: "VENTA", cantidad: -60 },
      { procesoMovimiento: "TRANSFERENCIA_SALIDA_SUCURSAL", procesoOperacion: "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: -40 },
    ]);
    expect(consumoReal).toBe(60); // sin filtrar la transferencia hubiera dado 100, no 60
  });

  it("escenario G (salsa producida, con conteos agregados): solo el consumo de la venta de pizza, no lo producido de más", () => {
    // 20 producido (PRODUCCION — no cuenta), 5 consumido por 10 pizzas a 0.5 c/u (CONSUMO/VENTA — sí cuenta).
    const consumoReal = consumoRealDelTramo([
      { procesoMovimiento: "PRODUCCION", procesoOperacion: "PRODUCCION", cantidad: 20 },
      { procesoMovimiento: "CONSUMO", procesoOperacion: "VENTA", cantidad: -5 },
    ]);
    expect(consumoReal).toBe(5); // sin filtrar PRODUCCION (que no es consumo) el número seguiría siendo 5 — la prueba real de G está en la capa de datos
  });

  it("el CONSUMO manual (pérdidas) y la MERMA no suman nada, aunque muevan el mismo insumo", () => {
    const consumoReal = consumoRealDelTramo([
      { procesoMovimiento: "CONSUMO", procesoOperacion: "VENTA", cantidad: -63 },
      { procesoMovimiento: "CONSUMO", procesoOperacion: "CONSUMO", cantidad: -5 }, // consumo manual, destino "Degustación" o similar
      { procesoMovimiento: "MERMA", procesoOperacion: "MERMA", cantidad: -3 },
    ]);
    expect(consumoReal).toBe(63);
  });

  it("sin movimientos que cuenten, da 0 (nunca null — eso lo decide el llamador con vendidoDelTramo)", () => {
    expect(consumoRealDelTramo([])).toBe(0);
  });
});

describe("esAnclaValida / elegirAnclas / anclasValidasEnVentana", () => {
  const PRODUCTO = "prod-agua";
  const SECCION = "seccion-deposito";
  const PAR = clavePar(PRODUCTO, SECCION);

  function candidato(fecha: string, contado: boolean, conSaldo: boolean): CandidatoAncla {
    return {
      fecha: new Date(fecha),
      paresContados: new Set(contado ? [PAR] : []),
      paresConSaldo: new Set(conSaldo ? [PAR] : []),
    };
  }

  it("un día con saldo 0 en todo el pool es ancla válida aunque no haya pares contados (vacío)", () => {
    expect(esAnclaValida(candidato("2026-01-02", false, false))).toBe(true);
  });

  it("un día con saldo != 0 SIN contar ese par no es ancla válida", () => {
    expect(esAnclaValida(candidato("2026-01-28", false, true))).toBe(false);
  });

  it("un día con saldo != 0 y el par contado ESE día sí es ancla válida", () => {
    expect(esAnclaValida(candidato("2026-01-28", true, true))).toBe(true);
  });

  it("elegirAnclas: toma la más temprana válida >= desde y la más tardía válida <= hasta", () => {
    const candidatos = [
      candidato("2026-01-02", false, false), // válida (vacía)
      candidato("2026-01-15", false, true), // NO válida (saldo sin contar) — no debería elegirse
      candidato("2026-01-28", true, true), // válida
    ];
    const anclas = elegirAnclas(candidatos, new Date("2026-01-01"), new Date("2026-01-31"));
    expect(anclas).not.toBeNull();
    expect(anclas!.anclaDesde.toISOString().slice(0, 10)).toBe("2026-01-02");
    expect(anclas!.anclaHasta.toISOString().slice(0, 10)).toBe("2026-01-28");
  });

  it("elegirAnclas: null (cae a COMPRAS) si hay menos de dos anclas válidas dentro de la ventana — escenarios C/D", () => {
    // Solo UNA ancla válida (o ninguna) — sin un segundo conteo que cierre el tramo, no hay tramo que medir.
    const soloUna = [candidato("2026-01-02", false, false)];
    expect(elegirAnclas(soloUna, new Date("2026-01-01"), new Date("2026-01-31"))).toBeNull();

    const ninguna: CandidatoAncla[] = [];
    expect(elegirAnclas(ninguna, new Date("2026-01-01"), new Date("2026-01-31"))).toBeNull();
  });

  it("elegirAnclas: null si las dos válidas son el MISMO día (no hay tramo con longitud > 0)", () => {
    const mismoDia = [candidato("2026-01-15", false, false), candidato("2026-01-15", false, false)];
    expect(elegirAnclas(mismoDia, new Date("2026-01-01"), new Date("2026-01-31"))).toBeNull();
  });

  it("elegirAnclas: ignora anclas válidas FUERA de la ventana [desde, hasta]", () => {
    const candidatos = [
      candidato("2025-12-01", false, false), // antes de desde — no cuenta como anclaDesde
      candidato("2026-01-10", false, false),
      candidato("2026-01-20", false, false),
      candidato("2026-03-01", false, false), // después de hasta — no cuenta como anclaHasta
    ];
    const anclas = elegirAnclas(candidatos, new Date("2026-01-01"), new Date("2026-01-31"));
    expect(anclas!.anclaDesde.toISOString().slice(0, 10)).toBe("2026-01-10");
    expect(anclas!.anclaHasta.toISOString().slice(0, 10)).toBe("2026-01-20");
  });

  it("anclasValidasEnVentana: devuelve TODAS las válidas ordenadas, no solo los dos extremos — para el caso compartido (§6)", () => {
    const candidatos = [
      candidato("2026-01-20", false, false),
      candidato("2026-01-02", false, false),
      candidato("2026-01-15", false, true), // inválida — no aparece
      candidato("2026-01-28", true, true),
    ];
    const fechas = anclasValidasEnVentana(candidatos, new Date("2026-01-01"), new Date("2026-01-31"));
    expect(fechas.map((f) => f.toISOString().slice(0, 10))).toEqual(["2026-01-02", "2026-01-20", "2026-01-28"]);
  });
});

describe("finDelDiaUtc / limitesDelTramo", () => {
  it("finDelDiaUtc: el último instante del día calendario UTC", () => {
    const f = finDelDiaUtc(new Date("2026-01-15T08:30:00Z"));
    expect(f.toISOString()).toBe("2026-01-15T23:59:59.999Z");
  });

  it("limitesDelTramo: excluye el día de la ancla-desde, incluye el día ENTERO de la ancla-hasta", () => {
    const { desde, hasta } = limitesDelTramo({ anclaDesde: new Date("2026-01-02"), anclaHasta: new Date("2026-01-28") });
    expect(desde.toISOString()).toBe("2026-01-02T23:59:59.999Z");
    expect(hasta.toISOString()).toBe("2026-01-28T23:59:59.999Z");
    // Un movimiento fechado el mismo día que anclaDesde (ej. el propio ajuste de esa ancla) queda FUERA del tramo (no es > desde).
    expect(new Date("2026-01-02T12:00:00Z").getTime() > desde.getTime()).toBe(false);
    // Un movimiento fechado el mismo día que anclaHasta (ej. el CONTROL del escenario B) queda DENTRO del tramo (es <= hasta).
    expect(new Date("2026-01-28T12:00:00Z").getTime() <= hasta.getTime()).toBe(true);
  });
});
