import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAXIMA,
  CONJUNTOS_DE_PORCIONES,
  decidirCantidadVendible,
  decidirCargarForma,
  ESCALA,
  esMultiploDelPaso,
  esPasoValido,
  leerDiezmilesimos,
  MOTIVOS_DE_CANTIDAD,
  MOTIVOS_DE_CARGA,
  pasoDeLaForma,
  pasoDePorciones,
  rechazoDePesoEnLaUnidadDeStock,
  sonLaMismaForma,
  validarPorciones,
  type FormaDeVenta,
  type Magnitud,
} from "@/core/catalogo/fracciones-y-peso";
import { convertirPasoLibre, fraccionMasCercana, RESULTADOS_DE_CONVERSION, revertirConversion } from "@/core/catalogo/conversion-de-paso-libre";
import { CASOS_DE_CONVERSION, CASOS_DEL_DISENO, EMPATES, enDiezmilesimos, esperadoDeVender } from "./fracciones-y-peso-oraculo";

/** Docs: docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md §5, §6, §8 y §12. Núcleo puro sin base: el recorrido es exhaustivo. */
const FORMAS: FormaDeVenta[] = [
  { tipo: "UNIDAD" },
  ...CONJUNTOS_DE_PORCIONES.map((porciones): FormaDeVenta => ({ tipo: "FRACCIONES", porciones })),
  { tipo: "PESO", paso: 10 }, // 0,001
  { tipo: "PESO", paso: 5000 }, // 0,5
  { tipo: "PASO_LIBRE", paso: 2000 }, // 0,2
  { tipo: "PASO_LIBRE", paso: 1000 }, // 0,1
  { tipo: "MASA_SIN_PASO" },
];
const CANTIDADES = ["0", "-1", "0.0625", "0.125", "0.25", "0.3", "0.4", "0.5", "0.35", "0.350", "0.3504", "0.001", "0.0001", "0.625", "1", "1.5", "2", "998.875", "999", "999.0001", "1000", "0.00001"];
const TEXTOS_RAROS: unknown[] = ["", "abc", "1/2", "1e3", " ", "1,5,5", "-", null, undefined, Number.NaN, Infinity, 0.1 + 0.2, {}, [], true];

describe("decidirCantidadVendible contra el oráculo (recorrido exhaustivo)", () => {
  it("el recorrido son 13 formas × 22 cantidades × 2 estados de la perilla = 572 combinaciones", () => {
    expect(FORMAS.length * CANTIDADES.length * 2).toBe(572);
  });

  it("cada combinación da lo que dice el oráculo (permitida o con el motivo), y nunca redondea la cantidad aceptada", () => {
    for (const forma of FORMAS) for (const cantidad of CANTIDADES) for (const perillaEncendida of [false, true]) {
      const { regla, esperado } = esperadoDeVender(forma, cantidad, perillaEncendida);
      const real = decidirCantidadVendible({ forma, cantidad, perillaEncendida });
      expect(real.ok ? "permitido" : real.motivo, `${regla}: ${JSON.stringify(forma)} / ${cantidad} / perilla=${perillaEncendida}`).toBe(esperado);
      if (real.ok) expect(BigInt(real.cantidad), "la cantidad aceptada es EXACTAMENTE la pedida").toBe(enDiezmilesimos(cantidad));
    }
  });

  it("los casos del diseño (O1 a O6, O16, I7), con sus números", () => {
    for (const c of CASOS_DEL_DISENO) {
      const r = decidirCantidadVendible({ forma: c.forma, cantidad: c.cantidad, perillaEncendida: c.perilla });
      expect(r.ok ? "permitido" : r.motivo, `${c.id}: ${JSON.stringify(c.forma)} / ${c.cantidad}`).toBe(c.esperado);
    }
  });

  it("I7: la perilla solo cambia una cosa, el paso libre heredado con una cantidad que no es entera", () => {
    for (const forma of FORMAS) for (const cantidad of CANTIDADES) {
      const apagada = decidirCantidadVendible({ forma, cantidad, perillaEncendida: false });
      const encendida = decidirCantidadVendible({ forma, cantidad, perillaEncendida: true });
      const cambia = JSON.stringify(apagada) !== JSON.stringify(encendida);
      const frenadaPorLaPerilla = forma.tipo === "PASO_LIBRE" && !apagada.ok && apagada.motivo === "SOLO_CANTIDADES_ENTERAS";
      expect(cambia, `${JSON.stringify(forma)} / ${cantidad}`).toBe(frenadaPorLaPerilla);
    }
  });

  it("falla cerrado: una forma desconocida o inválida, o una cantidad que no se puede leer exacta, se rechaza", () => {
    const base = { cantidad: "1", perillaEncendida: true };
    for (const forma of [null, undefined, {}, { tipo: "TERCIOS" }, { tipo: "FRACCIONES", porciones: [3] }, { tipo: "FRACCIONES", porciones: [] }, { tipo: "FRACCIONES", porciones: [2, 2] }, { tipo: "PESO", paso: 0 }, { tipo: "PESO", paso: 3000 }, { tipo: "PESO", paso: 0.5 }, { tipo: "PASO_LIBRE", paso: 20000 }]) {
      expect(decidirCantidadVendible({ ...base, forma } as never), JSON.stringify(forma)).toEqual({ ok: false, motivo: "FORMA_INVALIDA" });
    }
    for (const cantidad of TEXTOS_RAROS) {
      const r = decidirCantidadVendible({ forma: { tipo: "FRACCIONES", porciones: [2, 4, 8] }, cantidad, perillaEncendida: true });
      expect(r, String(cantidad)).toEqual({ ok: false, motivo: "CANTIDAD_INVALIDA" });
    }
  });

  it("los motivos son un conjunto cerrado y todos aparecen", () => {
    const usados = new Set<string>();
    for (const forma of FORMAS) for (const cantidad of CANTIDADES) for (const perillaEncendida of [false, true]) {
      const r = decidirCantidadVendible({ forma, cantidad, perillaEncendida });
      if (!r.ok) usados.add(r.motivo);
    }
    usados.add("FORMA_INVALIDA");
    usados.add("CANTIDAD_INVALIDA");
    expect([...usados].sort()).toEqual([...MOTIVOS_DE_CANTIDAD].sort());
  });

  it("es repetible: la misma entrada da siempre la misma decisión (idempotencia de una función pura)", () => {
    for (const forma of FORMAS) for (const cantidad of CANTIDADES) expect(decidirCantidadVendible({ forma, cantidad, perillaEncendida: true })).toEqual(decidirCantidadVendible({ forma, cantidad, perillaEncendida: true }));
  });

  it("dos ventas de ⅛ suman ¼ aunque ¼ no tenga botón: {2,8} acepta 0,125 + 0,125 (y la suma es exacta)", () => {
    const forma: FormaDeVenta = { tipo: "FRACCIONES", porciones: [2, 8] };
    const ocho = decidirCantidadVendible({ forma, cantidad: "0.125", perillaEncendida: true });
    expect(ocho).toEqual({ ok: true, cantidad: 1250 });
    expect(decidirCantidadVendible({ forma, cantidad: "0.25", perillaEncendida: true })).toEqual({ ok: true, cantidad: 1250 + 1250 });
  });
});

describe("lectura exacta, porciones y paso", () => {
  it("leerDiezmilesimos: texto o número con hasta 4 decimales, exacto; lo demás, null", () => {
    expect(leerDiezmilesimos("0,125")).toBe(1250);
    expect(leerDiezmilesimos("0.125")).toBe(1250);
    expect(leerDiezmilesimos("3")).toBe(30000);
    expect(leerDiezmilesimos(0.3)).toBe(3000);
    expect(leerDiezmilesimos(0.1 + 0.2)).toBeNull(); // no es 0,3 en binario: no se redondea
    expect(leerDiezmilesimos("0.12345")).toBeNull();
    expect(leerDiezmilesimos(0.12345)).toBeNull();
    expect(leerDiezmilesimos("-1")).toBe(-10000);
    for (const raro of ["", "--1", "1e3", "1/2", " ", null, undefined, Number.NaN, Infinity]) expect(leerDiezmilesimos(raro)).toBeNull();
  });

  it("I1: son siete conjuntos y validarPorciones solo admite esos, ordenados y sin repetir", () => {
    expect(CONJUNTOS_DE_PORCIONES).toHaveLength(7);
    expect(validarPorciones([8, 2])).toEqual([2, 8]);
    expect(validarPorciones([8, 4, 2])).toEqual([2, 4, 8]);
    for (const malo of [[], [3], [6], [2, 2], [1], [16], ["2"], null, undefined, "2", [2, 3]]) expect(validarPorciones(malo), JSON.stringify(malo)).toBeNull();
  });

  it("I2: el paso se deriva de la porción más fina (2 y 8 → ⅛ = 0,125)", () => {
    expect(CONJUNTOS_DE_PORCIONES.map((c) => pasoDePorciones(c))).toEqual([5000, 2500, 1250, 2500, 1250, 1250, 1250]);
  });

  it("T1: múltiplo con enteros, sin tolerancia; paso inválido no cumple nada", () => {
    expect(esMultiploDelPaso(3000, 1000)).toBe(true); // 0,3 = 3 × 0,1
    expect(esMultiploDelPaso(3001, 1000)).toBe(false);
    for (const paso of [0, -1, 0.5, Number.NaN]) expect(esMultiploDelPaso(10000, paso)).toBe(false);
  });

  it("paso válido (regla vigente): hasta 1, y 1 ÷ paso entero", () => {
    for (const bueno of [10000, 5000, 2500, 2000, 1250, 1000, 10, 1]) expect(esPasoValido(bueno), String(bueno)).toBe(true);
    for (const malo of [0, -5000, 3000, 6000, 9999, 10001, 20000, 0.5, Number.NaN, "5000", null]) expect(esPasoValido(malo), String(malo)).toBe(false);
  });

  it("peso en la unidad de stock (Q3): solo una unidad de masa, con un paso válido", () => {
    expect(rechazoDePesoEnLaUnidadDeStock("PESO", 10)).toBeNull();
    expect(rechazoDePesoEnLaUnidadDeStock("PESO", 3000)).toBe("PASO_INVALIDO");
    expect(rechazoDePesoEnLaUnidadDeStock("PESO", undefined)).toBe("PASO_INVALIDO");
    for (const m of ["CANTIDAD", "VOLUMEN"] as Magnitud[]) expect(rechazoDePesoEnLaUnidadDeStock(m, 10)).toBe("PESO_SOLO_EN_UNIDAD_DE_MASA");
  });

  it("O18: repetir la misma forma es «sin cambios», aunque las fracciones lleguen en otro orden; una inválida nunca es igual", () => {
    expect(sonLaMismaForma({ tipo: "FRACCIONES", porciones: [8, 2] }, { tipo: "FRACCIONES", porciones: [2, 8] })).toBe(true);
    expect(sonLaMismaForma({ tipo: "FRACCIONES", porciones: [2, 8] }, { tipo: "FRACCIONES", porciones: [8] })).toBe(false); // mismo paso, distinto conjunto
    expect(sonLaMismaForma({ tipo: "PESO", paso: 10 }, { tipo: "PESO", paso: 10 })).toBe(true);
    expect(sonLaMismaForma({ tipo: "PESO", paso: 10 }, { tipo: "PASO_LIBRE", paso: 10 })).toBe(false);
    expect(sonLaMismaForma({ tipo: "UNIDAD" }, { tipo: "UNIDAD" })).toBe(true);
    expect(sonLaMismaForma({ tipo: "FRACCIONES", porciones: [3] }, { tipo: "FRACCIONES", porciones: [3] })).toBe(false);
    expect(pasoDeLaForma({ tipo: "UNIDAD" })).toBe(ESCALA);
    expect(CANTIDAD_MAXIMA).toBe(9_990_000);
  });
});

describe("decidirCargarForma (I3, I4, I7, O15, O17)", () => {
  const FRACCIONES: FormaDeVenta = { tipo: "FRACCIONES", porciones: [2, 8] };
  const PESO: FormaDeVenta = { tipo: "PESO", paso: 10 };
  const casos: Array<[string, Parameters<typeof decidirCargarForma>[0], "permitido" | (typeof MOTIVOS_DE_CARGA)[number]]> = [
    ["fracciones, todo en orden", { destino: FRACCIONES, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: true }, "permitido"],
    ["O15: fracciones con la perilla apagada", { destino: FRACCIONES, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: false }, "PERILLA_APAGADA"],
    ["O15: peso con la perilla apagada", { destino: PESO, esProductoDeVenta: true, magnitud: "PESO", perillaEncendida: false }, "PERILLA_APAGADA"],
    ["peso, todo en orden", { destino: PESO, esProductoDeVenta: true, magnitud: "PESO", perillaEncendida: true }, "permitido"],
    ["O17: fracciones en una unidad de masa", { destino: FRACCIONES, esProductoDeVenta: true, magnitud: "PESO", perillaEncendida: true }, "FRACCIONES_SOLO_POR_UNIDAD"],
    ["O17: fracciones en una unidad de volumen", { destino: FRACCIONES, esProductoDeVenta: true, magnitud: "VOLUMEN", perillaEncendida: true }, "FRACCIONES_SOLO_POR_UNIDAD"],
    ["O17: fracciones en un producto que no se vende", { destino: FRACCIONES, esProductoDeVenta: false, magnitud: "CANTIDAD", perillaEncendida: true }, "SOLO_PRODUCTOS_DE_VENTA"],
    ["peso en un producto que no se vende", { destino: PESO, esProductoDeVenta: false, magnitud: "PESO", perillaEncendida: true }, "SOLO_PRODUCTOS_DE_VENTA"],
    ["peso en una unidad de conteo", { destino: PESO, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: true }, "PESO_SOLO_EN_UNIDAD_DE_MASA"],
    ["peso sin paso válido", { destino: { tipo: "PESO", paso: 3000 }, esProductoDeVenta: true, magnitud: "PESO", perillaEncendida: true }, "PASO_INVALIDO"],
    ["tercios (porciones no permitidas)", { destino: { tipo: "FRACCIONES", porciones: [3] }, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: true }, "PORCIONES_INVALIDAS"],
    ["volver a unidad con la perilla apagada (una baja no la pide)", { destino: { tipo: "UNIDAD" }, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: false }, "permitido"],
    ["volver a unidad en un producto que no se vende", { destino: { tipo: "UNIDAD" }, esProductoDeVenta: false, magnitud: "CANTIDAD", perillaEncendida: false }, "permitido"],
    ["una forma heredada no se elige (paso libre)", { destino: { tipo: "PASO_LIBRE", paso: 2000 }, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: true }, "FORMA_HEREDADA_NO_SE_ELIGE"],
    ["una forma heredada no se elige (masa sin paso)", { destino: { tipo: "MASA_SIN_PASO" }, esProductoDeVenta: true, magnitud: "PESO", perillaEncendida: true }, "FORMA_HEREDADA_NO_SE_ELIGE"],
    ["una forma desconocida cierra", { destino: { tipo: "TERCIOS" } as never, esProductoDeVenta: true, magnitud: "CANTIDAD", perillaEncendida: true }, "FORMA_HEREDADA_NO_SE_ELIGE"],
  ];
  it.each(casos)("%s", (_nombre, entrada, esperado) => {
    const r = decidirCargarForma(entrada);
    expect(r.ok ? "permitido" : r.motivo).toBe(esperado);
  });
  it("todos los motivos de carga aparecen en los casos", () => {
    const usados = new Set(casos.map((c) => c[2]).filter((x) => x !== "permitido"));
    expect([...usados].sort()).toEqual([...MOTIVOS_DE_CARGA].sort());
  });
});

describe("mapa de conversión de pasos libres (E1b, O21 a O27)", () => {
  const convertir = (t: string | null, magnitud: Magnitud = "CANTIDAD", porcionesActuales: (2 | 4 | 8)[] = []) =>
    convertirPasoLibre({ pasoVenta: t === null ? null : Number(enDiezmilesimos(t)), porcionesActuales, magnitud });

  it("la tabla del diseño, caso por caso", () => {
    for (const c of CASOS_DE_CONVERSION) {
      const r = convertir(c.paso);
      expect(r.resultado, `${c.id}: paso ${c.paso}`).toBe(c.resultado);
      if (c.porcion !== undefined && "porciones" in r) {
        expect(r.porciones, `${c.id}: paso ${c.paso}`).toEqual([c.porcion]);
        expect(r.pasoResultante).toBe(ESCALA / c.porcion);
      }
    }
  });

  it("los exactos se completan solos y el paso NO cambia (O21); lo demás no se aplica solo (O22, O23)", () => {
    for (const [t, p] of [["0.5", 2], ["0.25", 4], ["0.125", 8]] as const) {
      const r = convertir(t);
      expect(r).toEqual({ resultado: "AUTOMATICA", porciones: [p], pasoResultante: Number(enDiezmilesimos(t)) });
    }
    expect(convertir("0.2").resultado).toBe("PENDIENTE_CON_PROPUESTA");
  });

  it("O25: un empate de distancia va a la fracción MÁS FINA", () => {
    for (const e of EMPATES) expect(fraccionMasCercana(Number(enDiezmilesimos(e.paso))), e.paso).toBe(e.porcion);
  });

  it("recorrido de TODOS los pasos válidos (1 ÷ paso entero, hasta 4 decimales): siempre una propuesta, la más cercana, y exacta solo en ½, ¼ y ⅛", () => {
    let validos = 0;
    for (let p = 1; p < ESCALA; p++) {
      if ((ESCALA * ESCALA) % p !== 0) {
        expect(convertir(String(p / ESCALA)).resultado, `paso ${p} no admitido`).toBe("PENDIENTE_SIN_PROPUESTA");
        continue;
      }
      validos++;
      const r = convertirPasoLibre({ pasoVenta: p, porcionesActuales: [], magnitud: "CANTIDAD" });
      expect(r.resultado === "AUTOMATICA", `paso ${p}`).toBe(p === 5000 || p === 2500 || p === 1250);
      if (r.resultado === "AUTOMATICA" || r.resultado === "PENDIENTE_CON_PROPUESTA") {
        const distancias = [2, 4, 8].map((x) => Math.abs(p - ESCALA / x));
        expect(Math.abs(p - r.pasoResultante)).toBe(Math.min(...distancias));
      }
    }
    expect(validos).toBeGreaterThan(20);
  });

  it("no hay propuesta para lo que no es de conteo ni para lo no admitido (I3, I16): queda pendiente sin propuesta", () => {
    expect(convertir("0.5", "PESO").resultado).toBe("PENDIENTE_SIN_PROPUESTA");
    expect(convertir(null, "PESO").resultado).toBe("PENDIENTE_SIN_PROPUESTA"); // masa sin paso: elige la persona
    expect(convertir("0.5", "VOLUMEN").resultado).toBe("PENDIENTE_SIN_PROPUESTA");
    expect(convertir("1", "PESO").resultado).toBe("NADA");
  });

  it("O26: convertir dos veces no cambia nada (lo que ya tiene fracciones no se toca)", () => {
    for (const t of ["0.5", "0.2", "0.3", null]) expect(convertir(t, "CANTIDAD", [4]).resultado, String(t)).toBe("NADA");
    const primera = convertir("0.5");
    expect(primera.resultado).toBe("AUTOMATICA");
    expect(convertir("0.5", "CANTIDAD", [2])).toEqual({ resultado: "NADA" });
  });

  it("O27: la reversa devuelve el paso original, vacía las fracciones y anula el original", () => {
    expect(revertirConversion(2000)).toEqual({ pasoVenta: 2000, porcionesOfrecidas: [], pasoLibreOriginal: null });
  });

  it("los resultados son un conjunto cerrado y todos aparecen en la tabla", () => {
    expect([...new Set(CASOS_DE_CONVERSION.map((c) => c.resultado))].sort()).toEqual([...RESULTADOS_DE_CONVERSION].sort());
  });
});
