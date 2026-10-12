import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODIGOS_DE_ERROR_DE_PRECIO,
  componerPrecioDeLinea,
  type OpcionParaPrecio,
  type PrecioComponido,
  type ResultadoDePrecio,
} from "../../../src/core/opciones/componer-precio-de-linea";
import type { DiferenciaDePrecio, TipoDeGrupoDeOpciones } from "../../../src/core/opciones/tipos";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, paraPrecio, permitidosDe, type Escenario } from "./escenarios";

/**
 * GO-0b, invariante I4 (diseño §5): el precio de la línea es la composición de §2.12, exacto al centavo. Casos del café, del hotel y del spa; después propiedades (fast-check)
 * contra un oráculo escrito aparte con decimal.js.
 */

function precio(r: ResultadoDePrecio): PrecioComponido {
  if (!r.ok) throw new Error(`se esperaba un precio y vino ${r.codigo}: ${r.mensaje}`);
  return r.precio;
}

function falla(r: ResultadoDePrecio) {
  if (r.ok) throw new Error("se esperaba un rechazo y se compuso un precio");
  expect(r.mensaje.trim().length, `el rechazo ${r.codigo} tiene que traer un mensaje para quien vende`).toBeGreaterThan(10);
  return r;
}

/** Elige opciones de un escenario, las valida contra la lista de permitidos y arma la entrada del compositor. */
function componerEscenario(escenario: Escenario, ids: Array<string | [string, number]>, cantidad = 1) {
  const elegidas = ids.map((i) => (typeof i === "string" ? { opcionId: i, cantidad: 1 } : { opcionId: i[0], cantidad: i[1] }));
  const validadas = validarOpcionesElegidas(permitidosDe(escenario), elegidas);
  if (!validadas.ok) throw new Error(`la elección no es válida: ${validadas.mensaje}`);
  return componerPrecioDeLinea({ precioBase: escenario.precioBase, cantidad, opciones: paraPrecio(escenario, validadas.opciones) });
}

describe("componerPrecioDeLinea: café", () => {
  it("chico, sin nada más: el precio propio del tamaño (2800), no el base (3000)", () => {
    const p = precio(componerEscenario(CAFE, ["o-chico"]));
    expect(p.precioDeLista).toBe(2800);
    expect(p.total).toBe(2800);
    expect(p.adicionales).toEqual([]);
  });

  it("mediano con leche: 3400 + 300 = 3700 por unidad; por 2, 7400", () => {
    const p = precio(componerEscenario(CAFE, ["o-mediano", "o-con-leche"], 2));
    expect(p.precioDeLista).toBe(3700);
    expect(p.importeDelProducto).toBe(7400);
    expect(p.total).toBe(7400);
    expect(p.dentroDelPrecio.map((d) => [d.opcionId, d.importeUnitario])).toEqual([
      ["o-mediano", 3400],
      ["o-con-leche", 300],
    ]);
  });

  it("mediano cortado: el cortado no cobra diferencia, queda en el precio del tamaño", () => {
    const p = precio(componerEscenario(CAFE, ["o-mediano", "o-cortado"]));
    expect(p.precioDeLista).toBe(3400);
    expect(p.dentroDelPrecio[1]).toMatchObject({ opcionId: "o-cortado", importeUnitario: 0, tipoDeDiferencia: "MONTO", porcentaje: null });
  });

  it("grande sin lactosa: 4000 + 8,5 % del precio base (3000 × 8,5 % = 255) = 4255, y la foto guarda el porcentaje usado", () => {
    const p = precio(componerEscenario(CAFE, ["o-grande", "o-sin-lactosa"]));
    expect(p.precioDeLista).toBe(4255);
    expect(p.dentroDelPrecio[1]).toMatchObject({ importeUnitario: 255, tipoDeDiferencia: "PORCENTAJE", porcentaje: 8.5, modoPrecio: null, factorEscala: null });
    expect(p.dentroDelPrecio[0]).toMatchObject({ importeUnitario: 4000, modoPrecio: "ABSOLUTO", tipoDeDiferencia: null, porcentaje: null, factorEscala: 2 });
  });

  it("el shot extra es OTRA línea: no entra al precio del café, tiene su recargo y su cantidad (k × la del café)", () => {
    const p = precio(componerEscenario(CAFE, ["o-mediano", ["o-shot", 2]], 3));
    expect(p.precioDeLista).toBe(3400);
    expect(p.importeDelProducto).toBe(10200);
    expect(p.dentroDelPrecio.map((d) => d.opcionId)).toEqual(["o-mediano"]);
    expect(p.adicionales).toHaveLength(1);
    expect(p.adicionales[0]).toMatchObject({ opcionId: "o-shot", versionDeOpcionId: "v-shot-1", cantidadPorUnidad: 2, cantidad: 6, recargoUnitario: 500, importe: 3000 });
    expect(p.adicionales[0].detalle).toMatchObject({ tipo: "ADICIONAL", importeUnitario: 500, cantidad: 2, tipoDeDiferencia: "MONTO" });
    expect(p.total).toBe(13200);
  });
});

describe("componerPrecioDeLinea: hotel", () => {
  it("habitación doble con desayuno, 3 noches: 108000 por noche, 324000; con cama extra (tope 1) y 2 desayunos extra, 399000", () => {
    const sola = precio(componerEscenario(HOTEL, ["o-con-desayuno", "o-matrimonial"], 3));
    expect(sola.precioDeLista).toBe(108000);
    expect(sola.total).toBe(324000);
    const completa = precio(componerEscenario(HOTEL, ["o-con-desayuno", "o-dos-camas", "o-cama-extra", ["o-desayuno-extra", 2]], 3));
    expect(completa.precioDeLista).toBe(108000);
    expect(completa.adicionales.map((a) => [a.opcionId, a.cantidad, a.importe])).toEqual([
      ["o-cama-extra", 3, 45000],
      ["o-desayuno-extra", 6, 30000],
    ]);
    expect(completa.total).toBe(399000);
  });

  it("solo alojamiento y las camas incluidas no suman nada: queda el precio base", () => {
    const p = precio(componerEscenario(HOTEL, ["o-solo-alojamiento", "o-dos-camas"]));
    expect(p.precioDeLista).toBe(100000);
    expect(p.dentroDelPrecio.map((d) => d.importeUnitario)).toEqual([0, 0]);
  });
});

describe("componerPrecioDeLinea: spa", () => {
  it("masaje de 90 minutos con aceite premium (12,5 % del base = 2500): 27000 + 2500 = 29500; con piedras calientes, 33500", () => {
    const p = precio(componerEscenario(SPA, ["o-90", "o-aceite-premium", "o-lavanda"]));
    expect(p.precioDeLista).toBe(29500);
    const conPiedras = precio(componerEscenario(SPA, ["o-90", "o-aceite-premium", "o-lavanda", "o-piedras"]));
    expect(conPiedras.total).toBe(33500);
  });

  it("30, 60 y 90 minutos: el precio de cada duración, sin pasar por el base", () => {
    expect([ "o-30", "o-60", "o-90" ].map((d) => precio(componerEscenario(SPA, [d, "o-eucalipto"])).precioDeLista)).toEqual([12000, 20000, 27000]);
  });
});

describe("componerPrecioDeLinea: la MEDIDA en modo DIFERENCIA y el redondeo", () => {
  const medida = (diferencia: DiferenciaDePrecio): OpcionParaPrecio => ({
    opcionId: "m",
    versionDeOpcionId: "m-1",
    nombre: "Mediano",
    tipo: "MEDIDA",
    cantidad: 1,
    factorEscala: 1.5,
    modoPrecio: "DIFERENCIA",
    precioAbsoluto: null,
    diferencia,
  });
  const variante = (diferencia: DiferenciaDePrecio | null, opcionId = "v"): OpcionParaPrecio => ({
    opcionId,
    versionDeOpcionId: `${opcionId}-1`,
    nombre: "Variante",
    tipo: "VARIANTE",
    cantidad: 1,
    factorEscala: null,
    modoPrecio: null,
    precioAbsoluto: null,
    diferencia,
  });

  it("monto fijo: base 3000 + 500 = 3500; con una rebaja de 200, 2800", () => {
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [medida({ tipo: "MONTO", monto: 500 })] })).precioDeLista).toBe(3500);
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [medida({ tipo: "MONTO", monto: -200 })] })).precioDeLista).toBe(2800);
  });

  it("porcentaje: +15 % de 3000 = 3450; -10 % = 2700; el detalle guarda el modo, el porcentaje y el importe congelado", () => {
    const mas = precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [medida({ tipo: "PORCENTAJE", porcentaje: 15 })] }));
    expect(mas.precioDeLista).toBe(3450);
    expect(mas.dentroDelPrecio[0]).toMatchObject({ modoPrecio: "DIFERENCIA", tipoDeDiferencia: "PORCENTAJE", porcentaje: 15, importeUnitario: 450, factorEscala: 1.5 });
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [medida({ tipo: "PORCENTAJE", porcentaje: -10 })] })).precioDeLista).toBe(2700);
  });

  it("el empate de medio centavo sube UNA vez: 5 % de 1000,10 = 50,005 → 50,01; la rebaja del mismo porcentaje baja exactamente lo mismo", () => {
    const mas = precio(componerPrecioDeLinea({ precioBase: 1000.1, cantidad: 1, opciones: [variante({ tipo: "PORCENTAJE", porcentaje: 5 })] }));
    expect(mas.dentroDelPrecio[0].importeUnitario).toBe(50.01);
    expect(mas.precioDeLista).toBe(1050.11);
    const menos = precio(componerPrecioDeLinea({ precioBase: 1000.1, cantidad: 1, opciones: [variante({ tipo: "PORCENTAJE", porcentaje: -5 })] }));
    expect(menos.dentroDelPrecio[0].importeUnitario).toBe(-50.01);
    expect(menos.precioDeLista).toBe(950.09);
  });

  it("el porcentaje de una variante es sobre el precio BASE, también cuando la medida tiene precio propio", () => {
    const abs: OpcionParaPrecio = { ...medida({ tipo: "MONTO", monto: 0 }), modoPrecio: "ABSOLUTO", precioAbsoluto: 20000 };
    const p = precio(componerPrecioDeLinea({ precioBase: 1000, cantidad: 1, opciones: [abs, variante({ tipo: "PORCENTAJE", porcentaje: 10 })] }));
    expect(p.dentroDelPrecio[1].importeUnitario).toBe(100);
    expect(p.precioDeLista).toBe(20100);
  });

  it("una variante sin diferencia vale 0 y no deja rastro de modo ni porcentaje", () => {
    const p = precio(componerPrecioDeLinea({ precioBase: 500, cantidad: 1, opciones: [variante(null)] }));
    expect(p.dentroDelPrecio[0]).toMatchObject({ importeUnitario: 0, tipoDeDiferencia: null, porcentaje: null, modoPrecio: null });
    expect(p.precioDeLista).toBe(500);
  });

  it("la grilla de la sucursal queda anotada en la foto (precioDeSucursal)", () => {
    const abs: OpcionParaPrecio = { ...medida({ tipo: "MONTO", monto: 0 }), modoPrecio: "ABSOLUTO", precioAbsoluto: 3900, precioDeSucursal: true };
    const p = precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [abs] }));
    expect(p.dentroDelPrecio[0]).toMatchObject({ importeUnitario: 3900, precioDeSucursal: true });
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [{ ...abs, precioDeSucursal: undefined }] })).dentroDelPrecio[0].precioDeSucursal).toBe(false);
  });

  it("en modo ABSOLUTO se ignora la diferencia que traiga la versión, y en DIFERENCIA el precio absoluto que haya quedado de antes", () => {
    const abs: OpcionParaPrecio = { ...medida({ tipo: "MONTO", monto: 999 }), modoPrecio: "ABSOLUTO", precioAbsoluto: 3300 };
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [abs] })).precioDeLista).toBe(3300);
    const dif: OpcionParaPrecio = { ...medida({ tipo: "MONTO", monto: 100 }), precioAbsoluto: 7777 };
    expect(precio(componerPrecioDeLinea({ precioBase: 3000, cantidad: 1, opciones: [dif] })).precioDeLista).toBe(3100);
  });
});

describe("componerPrecioDeLinea: pisos y rechazos", () => {
  const base = { precioBase: 3000, cantidad: 1 };
  const medidaAbs = (precioAbsoluto: number | null): OpcionParaPrecio => ({
    opcionId: "m",
    versionDeOpcionId: "m-1",
    nombre: "Chico",
    tipo: "MEDIDA",
    cantidad: 1,
    factorEscala: 1,
    modoPrecio: "ABSOLUTO",
    precioAbsoluto,
    diferencia: null,
  });
  const adicional = (diferencia: DiferenciaDePrecio | null): OpcionParaPrecio => ({
    opcionId: "a",
    versionDeOpcionId: "a-1",
    nombre: "Cheddar",
    tipo: "ADICIONAL",
    cantidad: 1,
    factorEscala: null,
    modoPrecio: null,
    precioAbsoluto: null,
    diferencia,
  });
  const otra = (tipo: TipoDeGrupoDeOpciones, extra: Partial<OpcionParaPrecio> = {}): OpcionParaPrecio => ({
    opcionId: `${tipo}-1`,
    versionDeOpcionId: "x-1",
    nombre: "Algo",
    tipo,
    cantidad: 1,
    factorEscala: null,
    modoPrecio: null,
    precioAbsoluto: null,
    diferencia: null,
    ...extra,
  });

  it("el precio de lista tiene un piso de 0,01: una rebaja que lo deja en 0 o menos se rechaza", () => {
    const rebaja = (monto: number) => componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE", { diferencia: { tipo: "MONTO", monto } })] });
    expect(precio(rebaja(-2999.99)).precioDeLista).toBe(0.01);
    expect(falla(rebaja(-3000)).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
    expect(falla(rebaja(-3500)).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
    expect(falla(componerPrecioDeLinea({ precioBase: 0, cantidad: 1, opciones: [] })).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
  });

  it("sin opciones es el precio base tal cual, por la cantidad", () => {
    const p = precio(componerPrecioDeLinea({ precioBase: 1234.56, cantidad: 3, opciones: [] }));
    expect(p).toEqual({ precioDeLista: 1234.56, importeDelProducto: 3703.68, dentroDelPrecio: [], adicionales: [], total: 3703.68 });
  });

  it("el precio absoluto de la medida es de 0,01 o más, de 2 decimales, y tiene que estar", () => {
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [medidaAbs(0.01)] })).precioDeLista).toBe(0.01);
    for (const malo of [null, 0, -5, 0.001, 10.005, Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
      const r = falla(componerPrecioDeLinea({ ...base, opciones: [medidaAbs(malo)] }));
      expect(r.codigo, String(malo)).toBe("PRECIO_DE_OPCION_INVALIDO");
      expect(r.opcionId).toBe("m");
    }
  });

  it("una medida sin modo de precio no se cobra aunque traiga un precio absoluto y una diferencia válidos (no se adivina el modo)", () => {
    const r = falla(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(3400), modoPrecio: null, diferencia: { tipo: "MONTO", monto: 100 } }] }));
    expect(r).toMatchObject({ codigo: "PRECIO_DE_OPCION_INVALIDO", opcionId: "m", mensaje: "«Chico» no tiene definido cómo se cobra: precio propio o diferencia." });
  });

  it("un rechazo que no es de una opción no lleva opcionId (ni siquiera como undefined)", () => {
    expect(Object.keys(falla(componerPrecioDeLinea({ precioBase: -1, cantidad: 1, opciones: [] }))).sort()).toEqual(["codigo", "mensaje", "ok"]);
    expect(Object.keys(falla(componerPrecioDeLinea({ ...base, opciones: [medidaAbs(null)] }))).sort()).toEqual(["codigo", "mensaje", "ok", "opcionId"]);
  });

  it("una medida sin modo de precio, o en DIFERENCIA sin diferencia, no se cobra", () => {
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), modoPrecio: null }] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), modoPrecio: "DIFERENCIA", diferencia: null }] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
  });

  it("las diferencias tienen que ser importes de 2 decimales y porcentajes de 4 (mayores que -100)", () => {
    const con = (diferencia: DiferenciaDePrecio) => componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE", { diferencia })] });
    expect(precio(con({ tipo: "MONTO", monto: 10.5 })).precioDeLista).toBe(3010.5);
    expect(precio(con({ tipo: "PORCENTAJE", porcentaje: 0.0001 })).precioDeLista).toBe(3000);
    expect(precio(con({ tipo: "PORCENTAJE", porcentaje: 999.9999 })).precioDeLista).toBe(33000);
    expect(precio(con({ tipo: "PORCENTAJE", porcentaje: -99.99 })).precioDeLista).toBe(0.3);
    expect(falla(con({ tipo: "PORCENTAJE", porcentaje: -99.9999 })).codigo).toBe("PRECIO_DE_LISTA_INVALIDO"); // -2999,997 se redondea a -3000,00: la lista queda en 0
    for (const d of [
      { tipo: "MONTO", monto: 10.005 },
      { tipo: "MONTO", monto: Number.NaN },
      { tipo: "MONTO", monto: 1e12 },
      { tipo: "PORCENTAJE", porcentaje: 5.00001 },
      { tipo: "PORCENTAJE", porcentaje: -100 },
      { tipo: "PORCENTAJE", porcentaje: 1000 },
      { tipo: "PORCENTAJE", porcentaje: Number.NaN },
    ] as DiferenciaDePrecio[]) {
      expect(falla(con(d)).codigo, JSON.stringify(d)).toBe("PRECIO_DE_OPCION_INVALIDO");
    }
  });

  it("la INCLUIDA suma 0: una diferencia distinta de 0 es una configuración inválida (0 y -0 sí)", () => {
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA")] })).precioDeLista).toBe(3000);
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA", { diferencia: { tipo: "MONTO", monto: 0 } })] })).precioDeLista).toBe(3000);
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA", { diferencia: { tipo: "MONTO", monto: -0 } })] })).precioDeLista).toBe(3000);
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA", { diferencia: { tipo: "PORCENTAJE", porcentaje: 0 } })] })).precioDeLista).toBe(3000);
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA", { diferencia: { tipo: "MONTO", monto: 100 } })] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("INCLUIDA", { diferencia: { tipo: "PORCENTAJE", porcentaje: 5 } })] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
  });

  it("el ADICIONAL cobra solo un monto fijo de 0,01 o más: sin diferencia, en 0, en porcentaje o negativo se rechaza", () => {
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [adicional({ tipo: "MONTO", monto: 0.01 })] })).adicionales[0].recargoUnitario).toBe(0.01);
    for (const d of [null, { tipo: "MONTO", monto: 0 }, { tipo: "MONTO", monto: -100 }, { tipo: "MONTO", monto: 0.005 }, { tipo: "PORCENTAJE", porcentaje: 10 }] as Array<DiferenciaDePrecio | null>) {
      const r = falla(componerPrecioDeLinea({ ...base, opciones: [adicional(d)] }));
      expect(r.codigo, JSON.stringify(d)).toBe("RECARGO_INVALIDO");
      expect(r.mensaje).toBe("«Cheddar» es un adicional: su recargo tiene que ser un monto fijo de 0,01 o más.");
    }
  });

  it("solo la MEDIDA lleva modo de precio, precio absoluto y factor de escala; el factor es mayor que 0, hasta 10, de 4 decimales", () => {
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE", { modoPrecio: "DIFERENCIA" })] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE", { precioAbsoluto: 10 })] })).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE", { factorEscala: 1 })] })).codigo).toBe("FACTOR_DE_ESCALA_INVALIDO");
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), factorEscala: 10 }] })).precioDeLista).toBe(100);
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), factorEscala: 0.0001 }] })).precioDeLista).toBe(100);
    expect(precio(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), factorEscala: null }] })).dentroDelPrecio[0].factorEscala).toBeNull();
    for (const f of [0, -1, 10.0001, 1.00001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(falla(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), factorEscala: f }] })).codigo, String(f)).toBe("FACTOR_DE_ESCALA_INVALIDO");
    }
  });

  it("el precio base y las cantidades tienen que ser válidos", () => {
    expect(falla(componerPrecioDeLinea({ precioBase: -1, cantidad: 1, opciones: [] })).codigo).toBe("PRECIO_BASE_INVALIDO");
    expect(falla(componerPrecioDeLinea({ precioBase: Number.NaN, cantidad: 1, opciones: [] })).codigo).toBe("PRECIO_BASE_INVALIDO");
    expect(precio(componerPrecioDeLinea({ precioBase: 0, cantidad: 1, opciones: [medidaAbs(100)] })).precioDeLista).toBe(100);
    for (const cantidad of [0, -1, 1.5, Number.NaN]) {
      expect(falla(componerPrecioDeLinea({ precioBase: 100, cantidad, opciones: [] })).codigo, String(cantidad)).toBe("CANTIDAD_INVALIDA");
    }
    for (const cantidad of [0, 11, 1.5, -1]) {
      const r = falla(componerPrecioDeLinea({ ...base, opciones: [adicional({ tipo: "MONTO", monto: 5 })].map((a) => ({ ...a, cantidad })) }));
      expect(r.codigo, String(cantidad)).toBe("CANTIDAD_INVALIDA");
      expect(r.opcionId).toBe("a");
    }
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [{ ...medidaAbs(100), cantidad: 2 }] })).codigo).toBe("CANTIDAD_INVALIDA");
  });

  it("dos medidas, o la misma opción dos veces, se rechazan", () => {
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [medidaAbs(100), { ...medidaAbs(200), opcionId: "m2" }] })).codigo).toBe("MEDIDAS_MULTIPLES");
    expect(falla(componerPrecioDeLinea({ ...base, opciones: [otra("VARIANTE"), otra("VARIANTE")] })).codigo).toBe("OPCION_REPETIDA");
  });

  it("los códigos son una lista cerrada, sin repetidos, y los mensajes no hablan de un solo rubro", () => {
    expect(new Set(CODIGOS_DE_ERROR_DE_PRECIO).size).toBe(CODIGOS_DE_ERROR_DE_PRECIO.length);
    const r = falla(componerPrecioDeLinea({ ...base, opciones: [adicional(null)] }));
    expect(r.mensaje).not.toMatch(/plato|receta|cocina|comanda/i);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ */
/* Propiedades contra un oráculo con decimal.js                                                                       */
/* ------------------------------------------------------------------------------------------------------------------ */

const RUNS = { numRuns: 1000 };
const centavos = (min: number, max: number) => fc.integer({ min, max }).map((c) => c / 100);
const pct = (min: number, max: number) => fc.integer({ min, max }).map((m) => m / 10_000);

interface Generada {
  precioBase: number;
  cantidad: number;
  medida: null | { modo: "ABSOLUTO"; precio: number } | { modo: "DIFERENCIA"; diferencia: DiferenciaDePrecio };
  variantes: Array<DiferenciaDePrecio | null>;
  incluidas: number;
  adicionales: Array<{ k: number; recargo: number }>;
}

const diferenciaArb: fc.Arbitrary<DiferenciaDePrecio> = fc.oneof(
  centavos(-500_000, 500_000).map((monto) => ({ tipo: "MONTO", monto }) as const),
  pct(-500_000, 3_000_000).map((porcentaje) => ({ tipo: "PORCENTAJE", porcentaje }) as const)
);

const generadaArb: fc.Arbitrary<Generada> = fc.record({
  precioBase: centavos(0, 2_000_000),
  cantidad: fc.integer({ min: 1, max: 20 }),
  medida: fc.option(
    fc.oneof(
      centavos(1, 2_000_000).map((precio) => ({ modo: "ABSOLUTO", precio }) as const),
      diferenciaArb.map((diferencia) => ({ modo: "DIFERENCIA", diferencia }) as const)
    ),
    { nil: null }
  ),
  variantes: fc.array(fc.option(diferenciaArb, { nil: null }), { maxLength: 3 }),
  incluidas: fc.integer({ min: 0, max: 3 }),
  adicionales: fc.array(fc.record({ k: fc.integer({ min: 1, max: 10 }), recargo: centavos(1, 500_000) }), { maxLength: 3 }),
});

function aOpciones(g: Generada): OpcionParaPrecio[] {
  const comun = { versionDeOpcionId: "v-1", nombre: "X", factorEscala: null, modoPrecio: null, precioAbsoluto: null, diferencia: null, cantidad: 1 } as const;
  return [
    ...(g.medida
      ? [
          {
            ...comun,
            opcionId: "medida",
            tipo: "MEDIDA" as const,
            modoPrecio: g.medida.modo,
            precioAbsoluto: g.medida.modo === "ABSOLUTO" ? g.medida.precio : null,
            diferencia: g.medida.modo === "DIFERENCIA" ? g.medida.diferencia : null,
          },
        ]
      : []),
    ...g.variantes.map((diferencia, i) => ({ ...comun, opcionId: `variante-${i}`, tipo: "VARIANTE" as const, diferencia })),
    ...Array.from({ length: g.incluidas }, (_, i) => ({ ...comun, opcionId: `incluida-${i}`, tipo: "INCLUIDA" as const })),
    ...g.adicionales.map((a, i) => ({ ...comun, opcionId: `adicional-${i}`, tipo: "ADICIONAL" as const, cantidad: a.k, diferencia: { tipo: "MONTO", monto: a.recargo } as const })),
  ];
}

const aDecimal = (n: number) => new Decimal(n);
/** El importe de una diferencia, con el redondeo del diseño: porcentaje del base, al centavo, mitad hacia arriba (alejándose del cero), una vez. */
function importeOraculo(d: DiferenciaDePrecio | null, base: number): Decimal {
  if (d === null) return aDecimal(0);
  return d.tipo === "MONTO" ? aDecimal(d.monto) : aDecimal(base).times(d.porcentaje).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function listaOraculo(g: Generada): Decimal {
  const base = g.medida?.modo === "ABSOLUTO" ? aDecimal(g.medida.precio) : aDecimal(g.precioBase).plus(g.medida ? importeOraculo(g.medida.diferencia, g.precioBase) : 0);
  return g.variantes.reduce((suma, d) => suma.plus(importeOraculo(d, g.precioBase)), base);
}

describe("componerPrecioDeLinea (propiedades)", () => {
  it("la suma de las partes en decimal es igual al total, al centavo (o se rechaza porque la lista queda en menos de 0,01)", () => {
    fc.assert(
      fc.property(generadaArb, (g) => {
        const lista = listaOraculo(g);
        const r = componerPrecioDeLinea({ precioBase: g.precioBase, cantidad: g.cantidad, opciones: aOpciones(g) });
        if (lista.lt("0.01")) {
          expect(r.ok).toBe(false);
          expect(!r.ok && r.codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
          return;
        }
        const p = precio(r);
        const totalEsperado = g.adicionales.reduce((suma, a) => suma.plus(aDecimal(g.cantidad).times(a.k).times(a.recargo)), lista.times(g.cantidad));
        expect(aDecimal(p.precioDeLista).eq(lista)).toBe(true);
        expect(aDecimal(p.importeDelProducto).eq(lista.times(g.cantidad))).toBe(true);
        expect(p.adicionales.reduce((suma, a) => suma.plus(a.importe), aDecimal(p.importeDelProducto)).eq(totalEsperado)).toBe(true);
        expect(aDecimal(p.total).eq(totalEsperado)).toBe(true);
        expect(aDecimal(p.total).decimalPlaces()).toBeLessThanOrEqual(2);
      }),
      RUNS
    );
  });

  it("el detalle reconstruye la lista: base (si la medida no es absoluta) + cantidad × importe de cada opción dentro del precio", () => {
    fc.assert(
      fc.property(generadaArb, (g) => {
        const r = componerPrecioDeLinea({ precioBase: g.precioBase, cantidad: g.cantidad, opciones: aOpciones(g) });
        if (!r.ok) return;
        const { precioDeLista, dentroDelPrecio } = r.precio;
        const absoluta = dentroDelPrecio.some((d) => d.modoPrecio === "ABSOLUTO");
        const reconstruida = dentroDelPrecio.reduce((suma, d) => suma.plus(aDecimal(d.cantidad).times(d.importeUnitario)), aDecimal(absoluta ? 0 : g.precioBase));
        expect(aDecimal(precioDeLista).eq(reconstruida)).toBe(true);
        for (const d of dentroDelPrecio) {
          expect(aDecimal(d.importeUnitario).decimalPlaces()).toBeLessThanOrEqual(2);
          expect(d.tipo).not.toBe("ADICIONAL");
          if (d.tipo === "INCLUIDA") expect(d.importeUnitario).toBe(0);
        }
      }),
      RUNS
    );
  });

  it("la lista y cada recargo son >= 0,01 siempre, o hay error: nunca un precio de 0 o negativo", () => {
    fc.assert(
      fc.property(generadaArb, (g) => {
        const r = componerPrecioDeLinea({ precioBase: g.precioBase, cantidad: g.cantidad, opciones: aOpciones(g) });
        if (!r.ok) return;
        expect(r.precio.precioDeLista).toBeGreaterThanOrEqual(0.01);
        for (const a of r.precio.adicionales) {
          expect(a.recargoUnitario).toBeGreaterThanOrEqual(0.01);
          expect(a.cantidad).toBe(g.cantidad * a.cantidadPorUnidad);
        }
      }),
      RUNS
    );
  });

  it("el orden en que llegan las opciones no cambia ni la lista ni el total", () => {
    const conOrden = generadaArb.chain((g) => fc.tuple(fc.constant(g), fc.shuffledSubarray(aOpciones(g), { minLength: aOpciones(g).length, maxLength: aOpciones(g).length })));
    fc.assert(
      fc.property(conOrden, ([g, barajadas]) => {
        const a = componerPrecioDeLinea({ precioBase: g.precioBase, cantidad: g.cantidad, opciones: aOpciones(g) });
        const b = componerPrecioDeLinea({ precioBase: g.precioBase, cantidad: g.cantidad, opciones: barajadas });
        expect(a.ok).toBe(b.ok);
        if (a.ok && b.ok) {
          expect(b.precio.precioDeLista).toBe(a.precio.precioDeLista);
          expect(b.precio.total).toBe(a.precio.total);
        }
      }),
      RUNS
    );
  });

  it("el redondeo del porcentaje es estable y simétrico: +p y -p del mismo base dan importes opuestos exactos", () => {
    const variante = (porcentaje: number): OpcionParaPrecio => ({
      opcionId: "v",
      versionDeOpcionId: "v-1",
      nombre: "V",
      tipo: "VARIANTE",
      cantidad: 1,
      factorEscala: null,
      modoPrecio: null,
      precioAbsoluto: null,
      diferencia: { tipo: "PORCENTAJE", porcentaje },
    });
    fc.assert(
      fc.property(centavos(1, 2_000_000), pct(1, 990_000), (precioBase, porcentaje) => {
        const mas = componerPrecioDeLinea({ precioBase, cantidad: 1, opciones: [variante(porcentaje)] });
        const menos = componerPrecioDeLinea({ precioBase, cantidad: 1, opciones: [variante(-porcentaje)] });
        const otraVez = componerPrecioDeLinea({ precioBase, cantidad: 1, opciones: [variante(porcentaje)] });
        expect(otraVez).toEqual(mas);
        if (!mas.ok || !menos.ok) return;
        const importeMas = mas.precio.dentroDelPrecio[0].importeUnitario;
        const importeMenos = menos.precio.dentroDelPrecio[0].importeUnitario;
        expect(importeMenos).toBe(importeMas === 0 ? 0 : -importeMas);
        expect(aDecimal(importeMas).eq(importeOraculo({ tipo: "PORCENTAJE", porcentaje }, precioBase))).toBe(true);
      }),
      RUNS
    );
  });
});
