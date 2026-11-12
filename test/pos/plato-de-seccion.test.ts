import { describe, expect, it } from "vitest";
import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import { armarComponenteDeSeccion, clasificarPlatoDeSeccion, type PlatoDeSeccionLeido } from "../../src/core/pos/plato-de-seccion";
import { validarYAplanarEleccionPromo, type CupoPromoDefinicion } from "../../src/core/pos/promo-combo";

/**
 * Bordes de la parte de sección con opciones (diseño 2026-11-11, E1a) que el oráculo exhaustivo no recorre: la forma de la elección, la identidad de la fila, el grupo INCLUIDA, los adicionales
 * opcionales y el fallo cerrado de la clasificación. La compatibilidad SIN opciones la fija `promo-combo-go3.propiedades.test.ts` (paridad con la versión anterior copiada).
 */

const monto = (m: number) => ({ tipo: "MONTO" as const, monto: m });
function opcion(opcionId: string, orden: number, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId, nombre: opcionId, orden, activa: true, admitida: true, apagadaEnSucursal: false, cantidadMaxima: 3, versionVigenteId: `v-${opcionId}`, esNinguna: false, productoAnclaId: null,
    diferenciaDeLaVersion: monto(0), factorEscala: null, consumos: [], precioAbsoluto: null, diferenciaDelProducto: null, precioDeSucursal: null, ...extra,
  };
}
function grupo(grupoId: string, tipo: GrupoParaVender["tipo"], minimo: number, opciones: OpcionParaVender[], extra: Partial<GrupoParaVender> = {}): GrupoParaVender {
  return { grupoId, nombre: grupoId, tipo, activo: true, admitido: true, cantidadMinima: minimo, cantidadMaxima: 2, orden: 0, modoPrecio: null, opciones, ...extra };
}
const plato = (grupos: GrupoParaVender[], extra: Partial<PlatoDeSeccionLeido> = {}): PlatoDeSeccionLeido => ({
  productoId: "p", producto: { nombre: "Café", tipo: "PV", esAnclaDeAdicional: false, seProduce: true, ingredientesDeLaRecetaVigente: 1 }, precioBase: 1000, precioGuardado: 1000, gruposDelProducto: grupos, ...extra,
});
const v = (id: string) => ({ opcionId: id, cantidad: 1, versionDeOpcionId: `v-${id}` });

describe("clasificarPlatoDeSeccion", () => {
  it("sin grupos, o con solo adicionales opcionales o grupos opcionales sin opción activa: SIN_OPCIONES (se pide como siempre)", () => {
    expect(clasificarPlatoDeSeccion([])).toEqual({ tipo: "SIN_OPCIONES" });
    expect(clasificarPlatoDeSeccion([grupo("extras", "ADICIONAL", 0, [opcion("huevo", 1, { productoAnclaId: "x" })])])).toEqual({ tipo: "SIN_OPCIONES" });
    expect(clasificarPlatoDeSeccion([grupo("salsa", "VARIANTE", 0, [opcion("mayo", 1, { apagadaEnSucursal: true })])])).toEqual({ tipo: "SIN_OPCIONES" });
    expect(clasificarPlatoDeSeccion([grupo("no-admitido", "VARIANTE", 1, [opcion("a", 1)], { admitido: false })])).toEqual({ tipo: "SIN_OPCIONES" });
  });

  it("obligatorias y opcionales se ofrecen, con todas sus opciones activas; el adicional nunca", () => {
    const r = clasificarPlatoDeSeccion([grupo("taza", "MEDIDA", 1, [opcion("chica", 1), opcion("grande", 2, { apagadaEnSucursal: true })]), grupo("salsa", "VARIANTE", 0, [opcion("mayo", 1)]), grupo("extras", "ADICIONAL", 0, [opcion("huevo", 1)])]);
    if (r.tipo !== "CON_OPCIONES") throw new Error(r.tipo);
    expect(r.grupos.map((g) => [g.grupoId, g.opciones.map((o) => o.opcionId)])).toEqual([["taza", ["chica"]], ["salsa", ["mayo"]]]);
  });

  it("falla CERRADO: adicional obligatorio, o grupo obligatorio sin opción activa (o apagado para la empresa): no se ofrece", () => {
    expect(clasificarPlatoDeSeccion([grupo("extras", "ADICIONAL", 1, [opcion("huevo", 1)])])).toMatchObject({ tipo: "NO_SE_OFRECE" });
    expect(clasificarPlatoDeSeccion([grupo("taza", "MEDIDA", 1, [opcion("a", 1, { apagadaEnSucursal: true })])])).toMatchObject({ tipo: "NO_SE_OFRECE" });
    expect(clasificarPlatoDeSeccion([grupo("taza", "MEDIDA", 1, [opcion("a", 1)], { activo: false })])).toMatchObject({ tipo: "NO_SE_OFRECE" });
    expect(clasificarPlatoDeSeccion([grupo("taza", "MEDIDA", 3, [opcion("a", 1, { cantidadMaxima: 1 }), opcion("b", 2, { cantidadMaxima: 1 })])])).toMatchObject({ tipo: "NO_SE_OFRECE" });
  });

  it("un grupo INCLUIDA se elige como una variante sin recargo: obligatoria exige elegir; opcional no", () => {
    const obligatoria = plato([grupo("incl", "INCLUIDA", 1, [opcion("papas", 1), opcion("ensalada", 2)])]);
    expect(armarComponenteDeSeccion(obligatoria, [])).toMatchObject({ ok: false, codigo: "OPCIONES_INVALIDAS" });
    expect(armarComponenteDeSeccion(obligatoria, [v("papas")])).toMatchObject({ ok: true, precioDeLista: 1000 });
    const opcional = plato([grupo("incl", "INCLUIDA", 0, [opcion("papas", 1)])]);
    expect(armarComponenteDeSeccion(opcional, undefined)).toMatchObject({ ok: true, precioDeLista: 1000 });
  });
});

describe("armarComponenteDeSeccion", () => {
  it("un plato sin nada que elegir: pesa el precio guardado, y las opciones que lleguen se RECHAZAN (nunca se ignoran)", () => {
    const sinOpciones = plato([grupo("extras", "ADICIONAL", 0, [opcion("huevo", 1, { productoAnclaId: "x" })])], { precioGuardado: 1234 });
    expect(armarComponenteDeSeccion(sinOpciones, undefined)).toMatchObject({ ok: true, precioDeLista: 1234, linea: null });
    expect(armarComponenteDeSeccion(sinOpciones, [])).toMatchObject({ ok: true, precioDeLista: 1234 });
    expect(armarComponenteDeSeccion(sinOpciones, [v("huevo")])).toMatchObject({ ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" });
  });

  it("un plato que no se ofrece (adicional obligatorio) se rechaza aunque llegue sin opciones", () => {
    expect(armarComponenteDeSeccion(plato([grupo("extras", "ADICIONAL", 1, [opcion("huevo", 1)])]), undefined)).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
  });

  it("I8: el peso es el de la configuración elegida, no el guardado", () => {
    const taza = plato([grupo("taza", "MEDIDA", 1, [opcion("chica", 1, { factorEscala: 1 }), opcion("grande", 2, { factorEscala: 1, diferenciaDeLaVersion: monto(500) })], { modoPrecio: "DIFERENCIA", cantidadMaxima: 1 })], { precioGuardado: 1000, precioBase: 1000 });
    expect(armarComponenteDeSeccion(taza, [v("grande")])).toMatchObject({ ok: true, precioDeLista: 1500 });
    expect(armarComponenteDeSeccion(taza, [v("chica")])).toMatchObject({ ok: true, precioDeLista: 1000 });
  });
});

describe("la elección de una parte de sección con opciones (`validarYAplanarEleccionPromo`)", () => {
  const cupo = (extra: Partial<CupoPromoDefinicion> = {}): CupoPromoDefinicion => ({
    seccionCartaId: "sec", nombreSeccion: "Cafés", cantidadMinima: 1, cantidadMaximaCupo: 3, elegibles: new Set(["cafe", "agua"]), conOpciones: new Set(["cafe"]), ...extra,
  });
  const eleccion = (elegidos: unknown[]) => [{ seccionCartaId: "sec", elegidos: elegidos as never }];

  it("el mismo plato con DOS configuraciones son dos componentes con su clave; con la MISMA, se rechaza como repetida", () => {
    const dos = validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica")] }, { productoId: "cafe", cantidad: 1, opciones: [v("grande")] }]));
    expect(dos.ok && dos.componentes.map((c) => c.claveComponente)).toEqual(["cafe#chica=1", "cafe#grande=1"]);
    const repetida = validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica")] }, { productoId: "cafe", cantidad: 1, opciones: [v("chica")] }]));
    expect(repetida).toMatchObject({ ok: false });
  });

  it("el mismo plato dos veces en UNA fila de 2 unidades se acepta (el 2x1), con o sin opciones", () => {
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 2, opciones: [v("chica")] }]))).toMatchObject({ ok: true });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "agua", cantidad: 2 }]))).toMatchObject({ ok: true });
  });

  it("un plato con opciones elegido sin ellas lleva la clave con marca `producto#` (nunca la del producto pelado) y `opciones` vacío", () => {
    const r = validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1 }]));
    expect(r).toEqual({ ok: true, componentes: [{ productoId: "cafe", cantidad: 1, claveComponente: "cafe#", opciones: [] }] });
  });

  it("a un plato SIN opciones no se le pueden mandar opciones (ni vacías): se rechaza", () => {
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "agua", cantidad: 1, opciones: [v("chica")] }]))).toMatchObject({ ok: false, mensaje: expect.stringContaining("no se eligen opciones") });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "agua", cantidad: 1, opciones: [] }]))).toMatchObject({ ok: false });
    expect(validarYAplanarEleccionPromo([cupo({ conOpciones: undefined })], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica")] }]))).toMatchObject({ ok: false });
  });

  it("un id de `conOpciones` que no es elegible nunca se puede elegir; una opción repetida, de cantidad fuera de rango o de forma rota se rechaza", () => {
    expect(validarYAplanarEleccionPromo([cupo({ elegibles: new Set(["agua"]) })], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica")] }]))).toMatchObject({ ok: false });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica"), v("chica")] }]))).toMatchObject({ ok: false });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [{ opcionId: "chica", cantidad: 11, versionDeOpcionId: "v" }] }]))).toMatchObject({ ok: false });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: "chica" }]))).toMatchObject({ ok: false, mensaje: "La elección de la promo tiene un formato inválido." });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [{ opcionId: "chica", cantidad: 1 }] }]))).toMatchObject({ ok: false, mensaje: "La elección de la promo tiene un formato inválido." });
  });

  it("el mínimo y el máximo son del CONJUNTO de la parte: cuentan las unidades de todas las filas, con o sin opciones", () => {
    expect(validarYAplanarEleccionPromo([cupo({ cantidadMinima: 3 })], eleccion([{ productoId: "cafe", cantidad: 1, opciones: [v("chica")] }, { productoId: "agua", cantidad: 1 }]))).toMatchObject({ ok: false, mensaje: expect.stringContaining("al menos 3") });
    expect(validarYAplanarEleccionPromo([cupo()], eleccion([{ productoId: "cafe", cantidad: 2, opciones: [v("chica")] }, { productoId: "cafe", cantidad: 2, opciones: [v("grande")] }]))).toMatchObject({ ok: false, mensaje: expect.stringContaining("máximo 3") });
  });
});
