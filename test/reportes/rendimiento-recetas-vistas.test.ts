import { describe, expect, it } from "vitest";
import {
  UMBRAL_DESVIO_AMBAR_PCT,
  bandaDeRuidoDeLote,
  calcularCantidadEstimadaNeta,
  calcularCantidadTeoricaBruta,
  calcularDesviacionPorcentaje,
  compararPorImpacto,
  dentroDeLaBanda,
  desvioEsNotable,
  explicarConfianza,
  impactoDelDesvio,
  motivoSinEstimacion,
  motivoSinEstimacionConteo,
  rotularLineaDeReceta,
} from "../../src/core/reportes/rendimiento-recetas-vistas";

describe("caso real: Agua mineral (72 comprados en cajas de 12, 63 vendidos, receta 1:1)", () => {
  const teorica = calcularCantidadTeoricaBruta(1, 0); // receta 1, sin merma
  const estimadaBruta = 72 / 63; // 1.142857...

  it("el desvío da +14,3 %, igual que el caso real de §3", () => {
    expect(calcularDesviacionPorcentaje(estimadaBruta, teorica)).toBeCloseTo(14.3, 1);
  });

  it("la banda de ruido de lote (mediana de compras de a 12) da 19,0 %", () => {
    const compras = [12, 12, 12, 12, 12, 12]; // 6 compras de una caja cada una = 72
    expect(bandaDeRuidoDeLote(compras, 63, teorica)).toBeCloseTo(19.0, 1);
  });

  it("el desvío de +14,3 % cae DENTRO de la banda de ±19,0 %", () => {
    const desvio = calcularDesviacionPorcentaje(estimadaBruta, teorica);
    const banda = bandaDeRuidoDeLote([12, 12, 12, 12, 12, 12], 63, teorica);
    expect(dentroDeLaBanda(desvio, banda)).toBe(true);
  });
});

describe("calcularCantidadTeoricaBruta", () => {
  it("sin merma: igual a la cantidad de receta", () => {
    expect(calcularCantidadTeoricaBruta(0.4, 0)).toBe(0.4);
  });

  it("con 20% de merma: cantidad × 1.2", () => {
    expect(calcularCantidadTeoricaBruta(1, 20)).toBe(1.2);
  });
});

describe("calcularCantidadEstimadaNeta / identidad bruto↔neto", () => {
  it("con merma, el % de desvío es el mismo mirando el bruto o el neto", () => {
    const cantidadReceta = 1;
    const mermaPorcentaje = 20;
    const teoricaBruta = calcularCantidadTeoricaBruta(cantidadReceta, mermaPorcentaje); // 1.2
    const estimadaBruta = 1.5;

    const desvioPorBruto = calcularDesviacionPorcentaje(estimadaBruta, teoricaBruta);
    const estimadaNeta = calcularCantidadEstimadaNeta(estimadaBruta, mermaPorcentaje);
    const desvioPorNeto = Math.round(((estimadaNeta - cantidadReceta) / cantidadReceta) * 1000) / 10;

    expect(desvioPorBruto).toBeCloseTo(desvioPorNeto, 1);
  });

  it("el neto es el que hay que escribir en la receta (no el bruto) — riesgo #9 del plan", () => {
    // Estimado bruto 1.2, con 20% de merma: neto = 1.2 / 1.2 = 1 (no 1.2, que sería el bruto sin dividir).
    expect(calcularCantidadEstimadaNeta(1.2, 20)).toBe(1);
  });
});

describe("calcularDesviacionPorcentaje", () => {
  it("null sin estimado", () => {
    expect(calcularDesviacionPorcentaje(null, 1)).toBeNull();
  });

  it("null con receta teórica 0 (nada contra qué comparar)", () => {
    expect(calcularDesviacionPorcentaje(1, 0)).toBeNull();
  });

  it("desvío positivo cuando el estimado es mayor a lo teórico", () => {
    expect(calcularDesviacionPorcentaje(0.5, 0.4)).toBe(25);
  });
});

describe("bandaDeRuidoDeLote", () => {
  it("null sin compras en la ventana", () => {
    expect(bandaDeRuidoDeLote([], 63, 1)).toBeNull();
  });

  it("null sin ventas", () => {
    expect(bandaDeRuidoDeLote([12], 0, 1)).toBeNull();
  });

  it("null con teórico 0", () => {
    expect(bandaDeRuidoDeLote([12], 63, 0)).toBeNull();
  });

  it("usa la MEDIANA, no el promedio: un lote atípico (la carga inicial) no distorsiona la banda", () => {
    // 5 compras de 12 + 1 carga inicial de 500 — la mediana sigue en 12; el promedio (98.7) daría una banda absurda.
    expect(bandaDeRuidoDeLote([12, 12, 12, 12, 12, 500], 63, 1)).toBeCloseTo(19.0, 1);
  });
});

describe("dentroDeLaBanda", () => {
  it("false sin banda calculable", () => {
    expect(dentroDeLaBanda(5, null)).toBe(false);
  });

  it("false sin desvío", () => {
    expect(dentroDeLaBanda(null, 20)).toBe(false);
  });

  it("false cuando el desvío excede la banda", () => {
    expect(dentroDeLaBanda(25, 19)).toBe(false);
  });
});

describe("desvioEsNotable — umbral FIJO en 10%, independiente de la banda de ruido", () => {
  it("la constante es 10", () => {
    expect(UMBRAL_DESVIO_AMBAR_PCT).toBe(10);
  });

  it("no notable por debajo del umbral", () => {
    expect(desvioEsNotable(9.9)).toBe(false);
  });

  it("notable en el umbral o por encima, sin importar si está dentro de la banda de ruido", () => {
    expect(desvioEsNotable(10)).toBe(true);
    expect(desvioEsNotable(14.3)).toBe(true); // el caso del Agua SÍ se pinta ámbar, aunque esté dentro de la banda — dentroDeLaBanda solo cambia el texto
  });

  it("null no es notable", () => {
    expect(desvioEsNotable(null)).toBe(false);
  });
});

describe("impactoDelDesvio", () => {
  it("null sin costo conocido — nunca se inventa un precio", () => {
    expect(impactoDelDesvio(72, 1, 63, null)).toBeNull();
  });

  it("null sin ventas", () => {
    expect(impactoDelDesvio(72, 1, 0, 10)).toBeNull();
  });

  it("positivo cuando entró más de lo que la receta preveía", () => {
    // 72 entradas, teórico 1 × 63 vendido = 63 esperado, 9 de más, a $10 = $90.
    expect(impactoDelDesvio(72, 1, 63, 10)).toBe(90);
  });

  it("negativo cuando entró menos de lo que la receta preveía", () => {
    expect(impactoDelDesvio(50, 1, 63, 10)).toBe(-130); // (50 - 63) * 10
  });
});

describe("compararPorImpacto", () => {
  const desempate = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");
  const impacto = (f: { impacto: number | null }) => f.impacto;

  it("ordena por |impacto| descendente", () => {
    const filas = [
      { nombre: "Ajo", impacto: 50 },
      { nombre: "Agua", impacto: 5 },
      { nombre: "Carne", impacto: -200 },
    ];
    filas.sort((a, b) => compararPorImpacto(a, b, impacto, desempate));
    expect(filas.map((f) => f.nombre)).toEqual(["Carne", "Ajo", "Agua"]); // 200, 50, 5 en valor absoluto
  });

  it("los null quedan siempre al final", () => {
    const filas = [
      { nombre: "Sin costo", impacto: null },
      { nombre: "Con costo", impacto: 5 },
    ];
    filas.sort((a, b) => compararPorImpacto(a, b, impacto, desempate));
    expect(filas.map((f) => f.nombre)).toEqual(["Con costo", "Sin costo"]);
  });

  it("con impacto igual (incluidos dos null), desempata alfabéticamente", () => {
    const filas = [
      { nombre: "Zapallo", impacto: null },
      { nombre: "Ajo", impacto: null },
    ];
    filas.sort((a, b) => compararPorImpacto(a, b, impacto, desempate));
    expect(filas.map((f) => f.nombre)).toEqual(["Ajo", "Zapallo"]);
  });
});

describe("motivoSinEstimacion", () => {
  it("sin ventas: motivo específico, no null", () => {
    expect(motivoSinEstimacion({ totalVendido: 0, totalEntradas: 10, cantidadTeoricaBruta: 1 })).toMatch(/no hubo ventas/i);
  });

  it("sin entradas (y hubo ventas): motivo específico — antes esto daba -100%", () => {
    expect(motivoSinEstimacion({ totalVendido: 10, totalEntradas: 0, cantidadTeoricaBruta: 1 })).toMatch(/no hubo compras ni producción/i);
  });

  it("receta en 0: motivo específico", () => {
    expect(motivoSinEstimacion({ totalVendido: 10, totalEntradas: 10, cantidadTeoricaBruta: 0 })).toMatch(/la receta dice 0/i);
  });

  it("con datos suficientes: null", () => {
    expect(motivoSinEstimacion({ totalVendido: 10, totalEntradas: 10, cantidadTeoricaBruta: 1 })).toBeNull();
  });
});

describe("motivoSinEstimacionConteo (método CONTEO — Task #26, Diseño B)", () => {
  it("sin ventas entre las anclas: motivo específico, no null", () => {
    expect(motivoSinEstimacionConteo({ vendidoDelTramo: 0, cantidadTeoricaBruta: 1 })).toMatch(/no hubo ventas.*entre las dos anclas/i);
  });

  it("receta en 0: mismo motivo que el método COMPRAS", () => {
    expect(motivoSinEstimacionConteo({ vendidoDelTramo: 10, cantidadTeoricaBruta: 0 })).toMatch(/la receta dice 0/i);
  });

  it("con datos suficientes: null — nunca exige 'entradas', el consumo se mide directo", () => {
    expect(motivoSinEstimacionConteo({ vendidoDelTramo: 10, cantidadTeoricaBruta: 1 })).toBeNull();
  });
});

describe("rotularLineaDeReceta", () => {
  const base = { insumoSeProduce: false, insumoEsNoComestible: false, pvSeProduce: false, cantidadReceta: 0.4, mermaPorcentaje: 0 };

  it("insumo que se produce: sub-receta producida (prioridad máxima)", () => {
    expect(rotularLineaDeReceta({ ...base, insumoSeProduce: true })).toBe("SUBRECETA_PRODUCIDA");
  });

  it("caso trampa: insumo que se produce Y es 1:1 sin merma — gana sub-receta producida, NO reventa", () => {
    expect(rotularLineaDeReceta({ ...base, insumoSeProduce: true, cantidadReceta: 1, mermaPorcentaje: 0 })).toBe("SUBRECETA_PRODUCIDA");
  });

  it("insumo packaging/no comestible", () => {
    expect(rotularLineaDeReceta({ ...base, insumoEsNoComestible: true })).toBe("PACKAGING_NO_COMESTIBLE");
  });

  it("PV que no se produce, receta 1:1 sin merma: producto de reventa (caso del agua)", () => {
    expect(rotularLineaDeReceta({ ...base, pvSeProduce: false, cantidadReceta: 1, mermaPorcentaje: 0 })).toBe("PRODUCTO_DE_REVENTA");
  });

  it("PV que SÍ se produce, aunque la receta sea 1:1: no es reventa (no aplica ningún rótulo)", () => {
    expect(rotularLineaDeReceta({ ...base, pvSeProduce: true, cantidadReceta: 1, mermaPorcentaje: 0 })).toBeNull();
  });

  it("receta normal (ni 1:1 ni producida ni packaging): sin rótulo", () => {
    expect(rotularLineaDeReceta(base)).toBeNull();
  });
});

describe("explicarConfianza", () => {
  it("alta: nombra las semanas con datos", () => {
    expect(explicarConfianza("alta", 9)).toBe("Alta — 9 semanas con datos");
  });

  it("media: explica que la ventana elegida es la que limita", () => {
    expect(explicarConfianza("media", 5)).toBe("Media — la ventana elegida tiene 5 semanas");
  });

  it("baja: 'solo N semanas'", () => {
    expect(explicarConfianza("baja", 2)).toBe("Baja — solo 2 semanas con datos");
  });

  it("sin_datos: sin número", () => {
    expect(explicarConfianza("sin_datos", 0)).toBe("Sin datos");
  });

  it("singular con 1 semana", () => {
    expect(explicarConfianza("baja", 1)).toBe("Baja — solo 1 semana con datos");
  });
});
