import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODIGOS_DE_ERROR_DE_CONFIGURACION,
  MAXIMO_CONSUMOS_POR_VERSION,
  MERMA_MAXIMA_DE_CONSUMO,
  cambiosPorColumna,
  cantidadesEfectivas,
  contenidoDeVersionIgual,
  controlarPrecioDeLista,
  esFactorValido,
  esMontoValido,
  esPorcentajeValido,
  validarAdmisionDeGrupo,
  validarConsumos,
  validarGrupo,
  validarOpcionNueva,
  validarVersion,
  type AdmisionDeOpcion,
  type ConsumoDeConfiguracion,
  type ContenidoDeVersion,
  type EntradaDeAdmision,
  type ResultadoDeConfiguracion,
} from "../../../src/core/opciones/validar-configuracion";
import { CANTIDAD_MAXIMA_DE_OPCION, FACTOR_DE_ESCALA_MAXIMO, TIPOS_DE_GRUPO_DE_OPCIONES, type DiferenciaDePrecio, type TipoDeGrupoDeOpciones } from "../../../src/core/opciones/tipos";
import { CAFE, HOTEL, SPA, type Escenario } from "./escenarios";

/**
 * GO-2a: las reglas puras de la CONFIGURACIÓN del catálogo de opciones de venta (`validar-configuracion.ts`). Cada regla con su código y su mensaje; los tres rubros del diseño
 * (café, hotel, spa) tienen que pasar enteros (lo que hoy venden los tests de GO-0b es configurable); propiedades de fast-check contra un oráculo escrito acá.
 */

const MONTO = (monto: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto });
const PORCENTAJE = (porcentaje: number): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje });

function rechazo(r: ResultadoDeConfiguracion) {
  if (r.ok) throw new Error("se esperaba un rechazo y se aceptó");
  expect(r.mensaje.trim().length, `el rechazo ${r.codigo} tiene que traer un mensaje para quien administra`).toBeGreaterThan(10);
  expect(CODIGOS_DE_ERROR_DE_CONFIGURACION).toContain(r.codigo);
  return r;
}

const suma = (insumoProductoId: string, cantidad = 1, extra: Partial<ConsumoDeConfiguracion> = {}): ConsumoDeConfiguracion => ({
  efecto: "SUMA",
  insumoProductoId,
  reemplazaAProductoId: null,
  cantidad,
  mermaPorcentaje: 0,
  escalaConLaMedida: false,
  ...extra,
});
const reemplaza = (aProductoId: string, insumoProductoId: string, cantidad = 1, extra: Partial<ConsumoDeConfiguracion> = {}): ConsumoDeConfiguracion => ({
  efecto: "REEMPLAZA",
  insumoProductoId,
  reemplazaAProductoId: aProductoId,
  cantidad,
  mermaPorcentaje: 0,
  escalaConLaMedida: false,
  ...extra,
});

/** La configuración de un escenario de GO-0b como la guardaría la pantalla: el grupo, cada opción con su versión 1 y la admisión del producto. */
function configuracionDe(escenario: Escenario) {
  return escenario.grupos.map((g) => {
    const opciones = escenario.opciones.filter((o) => o.grupoId === g.grupoId);
    const modoPrecio = g.tipo === "MEDIDA" ? (opciones[0]?.modoPrecio ?? null) : null;
    return {
      grupo: { tipo: g.tipo, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima },
      opciones: opciones.map((o) => ({
        def: o,
        version: { diferencia: o.diferencia ?? MONTO(0), factorEscala: o.factorEscala ?? null },
        consumos: (o.consumos ?? []).map((c) => ({
          efecto: c.efecto,
          insumoProductoId: c.insumoProductoId,
          reemplazaAProductoId: c.reemplazaAProductoId,
          cantidad: c.cantidad,
          mermaPorcentaje: c.mermaPorcentaje,
          escalaConLaMedida: c.escalaConLaMedida,
        })),
      })),
      admision: {
        grupo: { tipo: g.tipo, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima },
        opcionesDelGrupo: opciones.map((o) => ({ opcionId: o.opcionId, nombre: o.nombre, activa: true, esNinguna: o.esNinguna ?? false })),
        admision: { cantidadMinima: null, cantidadMaxima: null, modoPrecio, activo: true },
        opciones: opciones.map((o) => ({ opcionId: o.opcionId, cantidadMaxima: o.tope ?? 1, precioAbsoluto: o.precioAbsoluto ?? null, diferencia: null, activo: true })),
      } satisfies EntradaDeAdmision,
    };
  });
}

describe("los tres rubros del diseño se pueden CONFIGURAR enteros (café, hotel, spa)", () => {
  it.each([
    ["café", CAFE],
    ["hotel", HOTEL],
    ["spa", SPA],
  ] as const)("%s: cada grupo, cada opción (con su ancla si es adicional), su versión, sus consumos, la admisión y el control de precio de lista", (_rubro, escenario) => {
    for (const g of configuracionDe(escenario)) {
      expect(validarGrupo(g.grupo)).toEqual({ ok: true });
      for (const o of g.opciones) {
        const esNinguna = o.def.esNinguna ?? false;
        expect(validarOpcionNueva({ tipoDeGrupo: g.grupo.tipo, esNinguna, conAncla: g.grupo.tipo === "ADICIONAL" }), o.def.nombre).toEqual({ ok: true });
        expect(validarVersion(g.grupo.tipo, esNinguna, o.version), o.def.nombre).toEqual({ ok: true });
        expect(validarConsumos(g.grupo.tipo, esNinguna, o.consumos), o.def.nombre).toEqual({ ok: true });
      }
      expect(validarAdmisionDeGrupo(g.admision)).toEqual({ ok: true });
      const control = controlarPrecioDeLista(
        g.grupo.tipo,
        g.admision.admision.modoPrecio,
        escenario.precioBase,
        g.opciones.map((o) => ({ opcionId: o.def.opcionId, nombre: o.def.nombre, versionDeOpcionId: o.def.versionId, factorEscala: o.version.factorEscala, precioAbsoluto: o.def.precioAbsoluto ?? null, diferencia: o.version.diferencia }))
      );
      expect(control).toEqual({ ok: true });
    }
  });
});

describe("validarGrupo: las cantidades según el tipo", () => {
  it("MEDIDA solo 1 y 1; INCLUIDA mínimo 1 o más; VARIANTE y ADICIONAL de 0 al máximo", () => {
    expect(validarGrupo({ tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 }).ok).toBe(true);
    expect(rechazo(validarGrupo({ tipo: "MEDIDA", cantidadMinima: 0, cantidadMaxima: 1 })).codigo).toBe("CANTIDADES_INVALIDAS");
    expect(rechazo(validarGrupo({ tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 2 })).mensaje).toMatch(/mínimo 1 y máximo 1/);
    expect(rechazo(validarGrupo({ tipo: "INCLUIDA", cantidadMinima: 0, cantidadMaxima: 2 })).mensaje).toMatch(/obligatorio/);
    expect(validarGrupo({ tipo: "INCLUIDA", cantidadMinima: 2, cantidadMaxima: 2 }).ok).toBe(true);
    expect(validarGrupo({ tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 10 }).ok).toBe(true);
    expect(validarGrupo({ tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 }).ok).toBe(true);
  });

  it("bordes: máximo 0 u 11, mínimo negativo o mayor que el máximo, no enteros", () => {
    for (const [min, max] of [
      [0, 0],
      [0, CANTIDAD_MAXIMA_DE_OPCION + 1],
      [-1, 1],
      [3, 2],
      [0.5, 1],
      [0, 1.5],
      [Number.NaN, 1],
      [0, Number.POSITIVE_INFINITY],
    ]) {
      expect(rechazo(validarGrupo({ tipo: "VARIANTE", cantidadMinima: min!, cantidadMaxima: max! })).codigo, `${min}/${max}`).toBe("CANTIDADES_INVALIDAS");
    }
  });

  it("propiedad: acepta si y solo si el oráculo acepta", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIPOS_DE_GRUPO_DE_OPCIONES), fc.integer({ min: -2, max: 12 }), fc.integer({ min: -2, max: 12 }), (tipo, min, max) => {
        const oraculo = max >= 1 && max <= 10 && min >= 0 && min <= max && (tipo !== "MEDIDA" || (min === 1 && max === 1)) && (tipo !== "INCLUIDA" || min >= 1);
        expect(validarGrupo({ tipo, cantidadMinima: min, cantidadMaxima: max }).ok).toBe(oraculo);
      })
    );
  });
});

describe("validarOpcionNueva: la «ninguna» (D-2) y el ancla", () => {
  it("la «ninguna» solo en VARIANTE o INCLUIDA", () => {
    expect(validarOpcionNueva({ tipoDeGrupo: "VARIANTE", esNinguna: true, conAncla: false }).ok).toBe(true);
    expect(validarOpcionNueva({ tipoDeGrupo: "INCLUIDA", esNinguna: true, conAncla: false }).ok).toBe(true);
    expect(rechazo(validarOpcionNueva({ tipoDeGrupo: "MEDIDA", esNinguna: true, conAncla: false })).codigo).toBe("NINGUNA_NO_PERMITIDA");
    expect(rechazo(validarOpcionNueva({ tipoDeGrupo: "ADICIONAL", esNinguna: true, conAncla: true })).codigo).toBe("NINGUNA_NO_PERMITIDA");
  });

  it("el ADICIONAL exige su ancla; los demás la rechazan", () => {
    expect(validarOpcionNueva({ tipoDeGrupo: "ADICIONAL", esNinguna: false, conAncla: true }).ok).toBe(true);
    expect(rechazo(validarOpcionNueva({ tipoDeGrupo: "ADICIONAL", esNinguna: false, conAncla: false })).codigo).toBe("ANCLA_OBLIGATORIA");
    for (const tipo of ["MEDIDA", "VARIANTE", "INCLUIDA"] as const) {
      expect(rechazo(validarOpcionNueva({ tipoDeGrupo: tipo, esNinguna: false, conAncla: true })).codigo, tipo).toBe("ANCLA_NO_PERMITIDA");
      expect(validarOpcionNueva({ tipoDeGrupo: tipo, esNinguna: false, conAncla: false }).ok, tipo).toBe(true);
    }
  });
});

describe("validarVersion: la diferencia y el factor según el tipo", () => {
  it("INCLUIDA y «ninguna»: solo MONTO 0", () => {
    expect(validarVersion("INCLUIDA", false, { diferencia: MONTO(0), factorEscala: null }).ok).toBe(true);
    expect(rechazo(validarVersion("INCLUIDA", false, { diferencia: MONTO(0.01), factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
    expect(rechazo(validarVersion("INCLUIDA", false, { diferencia: PORCENTAJE(0), factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
    expect(validarVersion("VARIANTE", true, { diferencia: MONTO(0), factorEscala: null }).ok).toBe(true);
    expect(rechazo(validarVersion("VARIANTE", true, { diferencia: MONTO(10), factorEscala: null })).mensaje).toMatch(/«ninguna»/);
  });

  it("ADICIONAL: solo MONTO de 0,01 o más", () => {
    expect(validarVersion("ADICIONAL", false, { diferencia: MONTO(0.01), factorEscala: null }).ok).toBe(true);
    expect(rechazo(validarVersion("ADICIONAL", false, { diferencia: MONTO(0), factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
    expect(rechazo(validarVersion("ADICIONAL", false, { diferencia: MONTO(-5), factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
    expect(rechazo(validarVersion("ADICIONAL", false, { diferencia: PORCENTAJE(10), factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
  });

  it("PORCENTAJE solo en MEDIDA y VARIANTE; el monto puede ser negativo o 0 en MEDIDA y VARIANTE", () => {
    expect(validarVersion("MEDIDA", false, { diferencia: PORCENTAJE(-50), factorEscala: 0.5 }).ok).toBe(true);
    expect(validarVersion("VARIANTE", false, { diferencia: PORCENTAJE(12.5), factorEscala: null }).ok).toBe(true);
    expect(validarVersion("VARIANTE", false, { diferencia: MONTO(-150), factorEscala: null }).ok).toBe(true);
  });

  it("factor solo en MEDIDA, mayor que 0, hasta 10 y con hasta 4 decimales", () => {
    expect(validarVersion("MEDIDA", false, { diferencia: MONTO(0), factorEscala: FACTOR_DE_ESCALA_MAXIMO }).ok).toBe(true);
    expect(validarVersion("MEDIDA", false, { diferencia: MONTO(0), factorEscala: 0.0001 }).ok).toBe(true);
    for (const f of [0, -1, 10.0001, 0.00005, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rechazo(validarVersion("MEDIDA", false, { diferencia: MONTO(0), factorEscala: f })).codigo, String(f)).toBe("FACTOR_INVALIDO");
    }
    expect(rechazo(validarVersion("VARIANTE", false, { diferencia: MONTO(0), factorEscala: 1 })).mensaje).toMatch(/Solo una medida/);
  });

  it("formato: monto con 3 decimales, porcentaje de -100, de 1000 o con 5 decimales, NaN e Infinity se RECHAZAN (no se redondean)", () => {
    for (const d of [MONTO(10.005), MONTO(1e12), MONTO(Number.NaN), MONTO(Number.NEGATIVE_INFINITY), PORCENTAJE(-100), PORCENTAJE(1000), PORCENTAJE(1.00001), PORCENTAJE(Number.NaN)]) {
      expect(rechazo(validarVersion("VARIANTE", false, { diferencia: d, factorEscala: null })).codigo, JSON.stringify(d)).toBe("DIFERENCIA_INVALIDA");
    }
    expect(rechazo(validarVersion("VARIANTE", false, { diferencia: PORCENTAJE(-100), factorEscala: null })).mensaje).toMatch(/^El porcentaje/);
    expect(rechazo(validarVersion("VARIANTE", false, { diferencia: MONTO(0.001), factorEscala: null })).mensaje).toMatch(/^La diferencia de precio/);
    // Un rechazo sin opción no trae la clave `opcionId` (ni siquiera en `undefined`).
    expect(validarVersion("VARIANTE", false, { diferencia: MONTO(0.001), factorEscala: null })).toStrictEqual({ ok: false, codigo: "DIFERENCIA_INVALIDA", mensaje: expect.any(String) });
    expect(validarVersion("VARIANTE", false, { diferencia: PORCENTAJE(999.9999), factorEscala: null }).ok).toBe(true);
    expect(validarVersion("VARIANTE", false, { diferencia: PORCENTAJE(-99.9999), factorEscala: null }).ok).toBe(true);
    expect(rechazo(validarVersion("VARIANTE", false, { diferencia: { tipo: "OTRO" } as unknown as DiferenciaDePrecio, factorEscala: null })).codigo).toBe("DIFERENCIA_INVALIDA");
  });

  it("propiedad: con un monto válido, acepta si y solo si el oráculo del tipo acepta", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TIPOS_DE_GRUPO_DE_OPCIONES), fc.boolean(), fc.integer({ min: -100_000, max: 100_000 }), (tipo, esNinguna, centavos) => {
        const monto = centavos / 100;
        const oraculo = (!esNinguna || monto === 0) && (tipo !== "INCLUIDA" || monto === 0) && (tipo !== "ADICIONAL" || monto >= 0.01);
        expect(validarVersion(tipo, esNinguna, { diferencia: MONTO(monto), factorEscala: null }).ok).toBe(oraculo);
      })
    );
  });

  it("los validadores de formato coinciden con los CHECK de la base", () => {
    expect([esMontoValido(0.01), esMontoValido(999_999_999_999.99), esMontoValido(1e12), esMontoValido(0.001)]).toEqual([true, true, false, false]);
    expect([esPorcentajeValido(-99.9999), esPorcentajeValido(-100), esPorcentajeValido(999.9999), esPorcentajeValido(1000)]).toEqual([true, false, true, false]);
    expect([esFactorValido(0.0001), esFactorValido(0), esFactorValido(10), esFactorValido(10.0001)]).toEqual([true, false, true, false]);
  });
});

describe("validarConsumos", () => {
  it("SUMA sin reemplazado y REEMPLAZA con él", () => {
    expect(validarConsumos("VARIANTE", false, [suma("mp-leche"), reemplaza("mp-vaso", "mp-vaso-grande")]).ok).toBe(true);
    expect(rechazo(validarConsumos("VARIANTE", false, [suma("mp-leche", 1, { reemplazaAProductoId: "mp-vaso" })])).mensaje).toMatch(/línea 1.*no reemplaza/);
    expect(rechazo(validarConsumos("VARIANTE", false, [suma("mp-leche"), reemplaza("x", "mp-leche", 1, { reemplazaAProductoId: null })])).mensaje).toMatch(/línea 2.*falta cuál/);
    expect(rechazo(validarConsumos("VARIANTE", false, [{ ...suma("mp-leche"), efecto: "OTRO" } as unknown as ConsumoDeConfiguracion])).codigo).toBe("CONSUMO_INVALIDO");
  });

  it("el ADICIONAL solo SUMA y nunca escala con la medida", () => {
    expect(validarConsumos("ADICIONAL", false, [suma("mp-grano", 9)]).ok).toBe(true);
    expect(rechazo(validarConsumos("ADICIONAL", false, [reemplaza("mp-leche", "mp-avena")])).codigo).toBe("CONSUMO_INVALIDO");
    expect(rechazo(validarConsumos("ADICIONAL", false, [suma("mp-grano", 9, { escalaConLaMedida: true })])).codigo).toBe("CONSUMO_INVALIDO");
    expect(validarConsumos("VARIANTE", false, [suma("mp-leche", 100, { escalaConLaMedida: true })]).ok).toBe(true);
  });

  it("cantidad mayor que 0 con hasta 4 decimales; merma de 0 a 100 con hasta 2", () => {
    expect(validarConsumos("VARIANTE", false, [suma("a", 0.0001, { mermaPorcentaje: MERMA_MAXIMA_DE_CONSUMO })]).ok).toBe(true);
    for (const cantidad of [0, -1, 0.00001, 1e10, Number.NaN]) expect(rechazo(validarConsumos("VARIANTE", false, [suma("a", cantidad)])).mensaje, String(cantidad)).toMatch(/cantidad/);
    for (const merma of [-0.01, 100.01, 1.005, Number.NaN]) expect(rechazo(validarConsumos("VARIANTE", false, [suma("a", 1, { mermaPorcentaje: merma })])).mensaje, String(merma)).toMatch(/merma/);
  });

  it("un insumo de la base se reemplaza a lo sumo una vez por versión; el mismo insumo puede sumarse dos veces y reemplazarse por sí mismo (el «cortado» del café)", () => {
    expect(rechazo(validarConsumos("VARIANTE", false, [reemplaza("mp-leche", "a"), reemplaza("mp-leche", "b")])).mensaje).toMatch(/línea 2/);
    expect(validarConsumos("VARIANTE", false, [suma("a"), suma("a"), reemplaza("mp-leche", "mp-leche")]).ok).toBe(true);
  });

  it("la «ninguna» no consume nada; tope de líneas", () => {
    expect(rechazo(validarConsumos("INCLUIDA", true, [suma("a")])).mensaje).toMatch(/«ninguna»/);
    expect(validarConsumos("INCLUIDA", true, []).ok).toBe(true);
    expect(validarConsumos("VARIANTE", false, Array.from({ length: MAXIMO_CONSUMOS_POR_VERSION }, (_, i) => suma(`i${i}`))).ok).toBe(true);
    expect(rechazo(validarConsumos("VARIANTE", false, Array.from({ length: MAXIMO_CONSUMOS_POR_VERSION + 1 }, (_, i) => suma(`i${i}`)))).mensaje).toMatch(/como máximo/);
  });
});

describe("contenidoDeVersionIgual (la idempotencia de «agregar una versión»)", () => {
  const base: ContenidoDeVersion = { diferencia: MONTO(150), factorEscala: null, consumos: [reemplaza("mp-leche", "mp-almendras", 0.2), suma("mp-azucar", 1, { mermaPorcentaje: 5 })] };

  it("igual a sí misma y a una copia; distinta si cambia cualquier campo", () => {
    expect(contenidoDeVersionIgual(base, structuredClone(base))).toBe(true);
    const variantes: ContenidoDeVersion[] = [
      { ...base, diferencia: MONTO(151) },
      { ...base, diferencia: PORCENTAJE(150) },
      { ...base, factorEscala: 1 },
      { ...base, consumos: base.consumos.slice(0, 1) },
      { ...base, consumos: [...base.consumos].reverse() },
      ...(["efecto", "insumoProductoId", "reemplazaAProductoId", "cantidad", "mermaPorcentaje", "escalaConLaMedida"] as const).map((campo) => ({
        ...base,
        consumos: [{ ...base.consumos[0]!, [campo]: campo === "cantidad" || campo === "mermaPorcentaje" ? 9 : campo === "escalaConLaMedida" ? true : campo === "efecto" ? "SUMA" : "otro" }, base.consumos[1]!],
      })),
    ];
    for (const v of variantes) {
      expect(contenidoDeVersionIgual(base, v), JSON.stringify(v)).toBe(false);
      expect(contenidoDeVersionIgual(v, base), JSON.stringify(v)).toBe(false);
    }
    expect(contenidoDeVersionIgual({ ...base, diferencia: PORCENTAJE(5) }, { ...base, diferencia: PORCENTAJE(5) })).toBe(true);
    expect(contenidoDeVersionIgual({ ...base, diferencia: PORCENTAJE(5) }, { ...base, diferencia: PORCENTAJE(6) })).toBe(false);
  });
});

describe("validarAdmisionDeGrupo", () => {
  const opcionesDelGrupo = [
    { opcionId: "a", nombre: "A", activa: true, esNinguna: false },
    { opcionId: "b", nombre: "B", activa: true, esNinguna: false },
    { opcionId: "apagada", nombre: "Apagada", activa: false, esNinguna: false },
    { opcionId: "ninguna", nombre: "Sin nada", activa: true, esNinguna: true },
  ];
  const op = (opcionId: string, extra: Partial<AdmisionDeOpcion> = {}): AdmisionDeOpcion => ({ opcionId, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true, ...extra });
  const entrada = (tipo: TipoDeGrupoDeOpciones, extra: Partial<EntradaDeAdmision["admision"]> = {}, opciones: AdmisionDeOpcion[] = [op("a"), op("b")], grupo: Partial<EntradaDeAdmision["grupo"]> = {}): EntradaDeAdmision => ({
    grupo: { tipo, cantidadMinima: tipo === "MEDIDA" || tipo === "INCLUIDA" ? 1 : 0, cantidadMaxima: 1, ...grupo },
    opcionesDelGrupo,
    admision: { cantidadMinima: null, cantidadMaxima: null, modoPrecio: tipo === "MEDIDA" ? "DIFERENCIA" : null, activo: true, ...extra },
    opciones,
  });

  it("cantidades efectivas: las del producto mandan sobre las del grupo, y tienen que ser coherentes con el tipo", () => {
    expect(cantidadesEfectivas({ tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 3 }, { cantidadMinima: 1, cantidadMaxima: null })).toEqual({ cantidadMinima: 1, cantidadMaxima: 3 });
    expect(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 1, cantidadMaxima: 2 })).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 3 }))).codigo).toBe("CANTIDADES_INVALIDAS");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { cantidadMaxima: 2 }))).codigo).toBe("CANTIDADES_INVALIDAS");
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", { cantidadMinima: 0 }))).codigo).toBe("CANTIDADES_INVALIDAS");
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 11 }))).mensaje).toMatch(/mínimo de este producto/);
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMaxima: 0 }))).mensaje).toMatch(/máximo de este producto/);
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 0.5 }))).codigo).toBe("CANTIDADES_INVALIDAS");
  });

  it("la MEDIDA exige modo de precio; las demás lo rechazan; un modo desconocido se rechaza", () => {
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: null }))).codigo).toBe("MODO_DE_PRECIO_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { modoPrecio: "ABSOLUTO" }))).codigo).toBe("MODO_DE_PRECIO_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "OTRO" as never }))).mensaje).toMatch(/no es válido/);
  });

  it("MEDIDA en ABSOLUTO: precio propio de 0,01 o más en cada opción activa, sin diferencia; en DIFERENCIA, sin precio propio", () => {
    expect(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 2800 }), op("b", { precioAbsoluto: 0.01 })])).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 2800 }), op("b")]))).opcionId).toBe("b");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 0 })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 10.005 })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 100, diferencia: MONTO(1) })]))).mensaje).toMatch(/no lleva diferencia/);
    // Una opción apagada en el producto puede quedar sin precio propio (no se vende), y con uno, tiene que ser válido.
    expect(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 100 }), op("b", { activo: false })])).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "ABSOLUTO" }, [op("a", { precioAbsoluto: 100 }), op("b", { activo: false, precioAbsoluto: 0 })]))).opcionId).toBe("b");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "DIFERENCIA" }, [op("a", { precioAbsoluto: 100 })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("a", { precioAbsoluto: 100 })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(validarAdmisionDeGrupo(entrada("MEDIDA", { modoPrecio: "DIFERENCIA" }, [op("a", { diferencia: PORCENTAJE(-50) })])).ok).toBe(true);
  });

  it("la diferencia por producto: bien formada; nunca en una INCLUIDA ni en la «ninguna»; el ADICIONAL solo MONTO de 0,01 o más", () => {
    expect(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("a", { diferencia: PORCENTAJE(8.5) })])).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("a", { diferencia: PORCENTAJE(-100) })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, [op("a", { diferencia: MONTO(0) })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("ninguna", { diferencia: MONTO(5) })]))).opcionId).toBe("ninguna");
    expect(validarAdmisionDeGrupo(entrada("ADICIONAL", {}, [op("a", { diferencia: MONTO(0.01), cantidadMaxima: 3 })])).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("ADICIONAL", {}, [op("a", { diferencia: PORCENTAJE(5) })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("ADICIONAL", {}, [op("a", { diferencia: MONTO(0) })]))).codigo).toBe("PRECIO_DE_OPCION_INVALIDO");
  });

  it("opciones del mismo grupo, sin repetir, con tope entero de 1 a 10 (1 en la MEDIDA)", () => {
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("de-otro-grupo")]))).codigo).toBe("OPCION_DE_OTRO_GRUPO");
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", {}, [op("a"), op("a")]))).codigo).toBe("OPCION_REPETIDA");
    for (const tope of [0, 11, 1.5]) expect(rechazo(validarAdmisionDeGrupo(entrada("ADICIONAL", {}, [op("a", { cantidadMaxima: tope, diferencia: MONTO(1) })]))).codigo, String(tope)).toBe("CANTIDADES_INVALIDAS");
    expect(rechazo(validarAdmisionDeGrupo(entrada("MEDIDA", {}, [op("a", { cantidadMaxima: 2 })]))).mensaje).toMatch(/tope 1/);
  });

  it("el mínimo se tiene que poder alcanzar con las opciones ACTIVAS que el producto admite (las apagadas en la empresa o en el producto no cuentan); una admisión apagada no se mide", () => {
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, []))).codigo).toBe("MINIMO_INALCANZABLE");
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, [op("apagada")]))).codigo).toBe("MINIMO_INALCANZABLE");
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, [op("a", { activo: false })]))).codigo).toBe("MINIMO_INALCANZABLE");
    expect(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, [op("ninguna")])).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("INCLUIDA", {}, []))).mensaje).toMatch(/al menos 1 opción del grupo/);
    expect(validarAdmisionDeGrupo(entrada("INCLUIDA", { activo: false }, [])).ok).toBe(true);
    // Se cuentan UNIDADES: un mínimo de 3 se alcanza con una opción de tope 3.
    expect(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 3 }, [op("a", { cantidadMaxima: 3 })], { cantidadMaxima: 3 })).ok).toBe(true);
    expect(rechazo(validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: 3 }, [op("a", { cantidadMaxima: 2 })], { cantidadMaxima: 3 }))).mensaje).toMatch(/al menos 3 opciones/);
  });

  it("propiedad: el mínimo es alcanzable si y solo si la suma de los topes activos llega", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), fc.array(fc.record({ tope: fc.integer({ min: 1, max: 10 }), activo: fc.boolean() }), { maxLength: 2 }), (minimo, filas) => {
        const opciones = filas.map((f, i) => op(["a", "b"][i]!, { cantidadMaxima: f.tope, activo: f.activo }));
        const r = validarAdmisionDeGrupo(entrada("VARIANTE", { cantidadMinima: minimo }, opciones, { cantidadMaxima: 10 }));
        const alcanzable = filas.filter((f) => f.activo).reduce((s, f) => s + f.tope, 0) >= minimo;
        expect(r.ok).toBe(alcanzable);
        if (!r.ok) expect(r.codigo).toBe("MINIMO_INALCANZABLE");
      })
    );
  });
});

describe("controlarPrecioDeLista: cada opción sola sobre el precio de venta", () => {
  const o = (diferencia: DiferenciaDePrecio | null, extra: { precioAbsoluto?: number | null; factorEscala?: number | null } = {}) => ({
    opcionId: "x",
    nombre: "X",
    versionDeOpcionId: "v",
    factorEscala: extra.factorEscala ?? null,
    precioAbsoluto: extra.precioAbsoluto ?? null,
    diferencia,
  });

  it("una variante que deja el precio en menos de 0,01 se rechaza; una que lo deja en 0,01 pasa", () => {
    expect(rechazo(controlarPrecioDeLista("VARIANTE", null, 1000, [o(MONTO(-1000))])).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
    expect(controlarPrecioDeLista("VARIANTE", null, 1000, [o(MONTO(-999.99))]).ok).toBe(true);
    expect(rechazo(controlarPrecioDeLista("MEDIDA", "DIFERENCIA", 1000, [o(PORCENTAJE(-99.9999))])).mensaje).toMatch(/«X»/);
  });

  it("fuera de la MEDIDA el factor, el modo y el precio propio no viajan al compositor (no son de esa opción)", () => {
    expect(controlarPrecioDeLista("VARIANTE", "ABSOLUTO", 1000, [o(MONTO(10), { factorEscala: 1.5, precioAbsoluto: 5 })])).toStrictEqual({ ok: true });
    expect(controlarPrecioDeLista("MEDIDA", "DIFERENCIA", 1000, [o(MONTO(10), { factorEscala: 1.5 })])).toStrictEqual({ ok: true });
    expect(rechazo(controlarPrecioDeLista("MEDIDA", "ABSOLUTO", 1000, [o(MONTO(0), { precioAbsoluto: null })])).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
  });

  it("la medida absoluta toma su precio; la incluida no cambia nada; el adicional necesita su recargo", () => {
    expect(controlarPrecioDeLista("MEDIDA", "ABSOLUTO", 0, [o(MONTO(0), { precioAbsoluto: 2800, factorEscala: 1.5 })]).ok).toBe(true);
    expect(controlarPrecioDeLista("INCLUIDA", null, 1000, [o(MONTO(0))]).ok).toBe(true);
    expect(controlarPrecioDeLista("ADICIONAL", null, 1000, [o(MONTO(200))]).ok).toBe(true);
    expect(rechazo(controlarPrecioDeLista("ADICIONAL", null, 1000, [o(null)])).codigo).toBe("PRECIO_DE_LISTA_INVALIDO");
  });
});

describe("cambiosPorColumna (el antes y el después)", () => {
  it("solo lo que cambió; null y undefined son «sin valor»", () => {
    expect(cambiosPorColumna({ nombre: "A", activo: true, min: 0 }, { nombre: "A", activo: false, min: 1 }, ["nombre", "activo", "min"])).toEqual([
      { campo: "activo", antes: true, despues: false },
      { campo: "min", antes: 0, despues: 1 },
    ]);
    expect(cambiosPorColumna({ a: null }, { a: undefined as unknown as null }, ["a"])).toEqual([]);
    expect(cambiosPorColumna({ a: 0 }, { a: null }, ["a"])).toEqual([{ campo: "a", antes: 0, despues: null }]);
  });

  it("propiedad: vacío si y solo si los dos registros son iguales en las columnas pedidas", () => {
    const valor = fc.oneof(fc.constant(null), fc.boolean(), fc.integer({ min: -3, max: 3 }), fc.constantFrom("a", "b"));
    fc.assert(
      fc.property(fc.tuple(valor, valor, valor), fc.tuple(valor, valor, valor), ([a1, a2, a3], [b1, b2, b3]) => {
        const cambios = cambiosPorColumna({ x: a1, y: a2, z: a3 }, { x: b1, y: b2, z: b3 }, ["x", "y", "z"]);
        expect(cambios.length === 0).toBe(a1 === b1 && a2 === b2 && a3 === b3);
        expect(cambios.map((c) => c.campo)).toEqual((["x", "y", "z"] as const).filter((_, i) => [a1, a2, a3][i] !== [b1, b2, b3][i]));
      })
    );
  });
});
