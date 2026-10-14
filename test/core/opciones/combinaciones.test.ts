import { describe, expect, it } from "vitest";
import {
  entradaConPrecioDeCombinacion,
  identidadDeCombinacion,
  ORIGENES_DE_PRECIO_DE_COMBINACION,
  resolverPrecioDeCombinacion,
  validarEjesDeCombinacion,
  type CombinacionParaPrecio,
  type GrupoParaEjes,
} from "../../../src/core/opciones/combinaciones";
import { componerPrecioDeLinea, type EntradaDePrecioDeLinea, type OpcionParaPrecio } from "../../../src/core/opciones/componer-precio-de-linea";

/**
 * GO-3 (ADR-032, frente A), paso A1: el precio por combinación, puro. El café con dos ejes (Tamaño: Chico/Mediano/Grande, MEDIDA; Tipo: Cortado/Lágrima/Flat white, VARIANTE) más una opción que
 * NO es eje (Leche de almendras, +10 %). Sin fila rige el aditivo de GO-1 tal cual (la MISMA entrada); el flat white chico está apagado; el cortado y la lágrima medianos usan la tarifa «Café
 * mediano»; el flat white mediano tiene precio propio; el precio de la sucursal le gana; el porcentaje de la opción que no es eje se calcula sobre P.
 * Mutaciones demostradas: no rechazar la combinación inactiva (cae «el flat white chico no se vende»), dejar ganar el precio de la empresa sobre el local (cae «el precio local le gana») y dejar la
 * diferencia de la VARIANTE del eje (cae «el porcentaje sobre P»).
 */

const opcion = (opcionId: string, tipo: OpcionParaPrecio["tipo"], extra: Partial<OpcionParaPrecio> = {}): OpcionParaPrecio => ({
  opcionId,
  versionDeOpcionId: `v-${opcionId}`,
  nombre: opcionId,
  tipo,
  cantidad: 1,
  factorEscala: null,
  modoPrecio: null,
  precioAbsoluto: null,
  diferencia: null,
  ...extra,
});

/** Un flat white mediano con leche de almendras, como lo arma GO-2b sin combinación: base 3000, Mediano +300, Flat white +900, almendras +10 %. */
const entradaDeHoy = (): EntradaDePrecioDeLinea => ({
  precioBase: 3000,
  cantidad: 2,
  opciones: [
    opcion("mediano", "MEDIDA", { modoPrecio: "DIFERENCIA", diferencia: { tipo: "MONTO", monto: 300 }, factorEscala: 1.5 }),
    opcion("flat-white", "VARIANTE", { diferencia: { tipo: "MONTO", monto: 900 } }),
    opcion("almendras", "VARIANTE", { diferencia: { tipo: "PORCENTAJE", porcentaje: 10 } }),
  ],
});
const EJES = ["mediano", "flat-white"];
const sinLocales = { deLaCombinacion: null, delGrupo: null };
const tarifa = { grupoDePrecioId: "gp-mediano", nombre: "Café mediano", precio: 3300, activo: true };
const comb = (over: Partial<CombinacionParaPrecio> = {}): CombinacionParaPrecio => ({ combinacionId: "c1", activa: true, precio: null, grupo: null, ...over });

describe("validarEjesDeCombinacion", () => {
  const grupo = (over: Partial<GrupoParaEjes>): GrupoParaEjes => ({ grupoId: "g", nombre: "G", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, eje: null, ...over });

  it("acepta hasta dos ejes (una MEDIDA y una VARIANTE de una opción exacta) y devuelve el grupo de cada uno; sin ejes también", () => {
    expect(validarEjesDeCombinacion([grupo({ grupoId: "tam", tipo: "MEDIDA", eje: 1 }), grupo({ grupoId: "tipo", eje: 2 }), grupo({ grupoId: "extra", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 3 })])).toEqual({
      ok: true,
      ejes: { eje1: "tam", eje2: "tipo" },
    });
    expect(validarEjesDeCombinacion([grupo({ grupoId: "tipo", eje: 1 })])).toEqual({ ok: true, ejes: { eje1: "tipo", eje2: null } });
    expect(validarEjesDeCombinacion([grupo({})])).toEqual({ ok: true, ejes: { eje1: null, eje2: null } });
  });

  it("rechaza con EJES_INVALIDOS: tres ejes, un número repetido o fuera de 1-2, el eje 2 sin el 1, una INCLUIDA o un ADICIONAL, un grupo que no elige exactamente uno y dos MEDIDA", () => {
    for (const grupos of [
      [grupo({ grupoId: "a", eje: 1 }), grupo({ grupoId: "b", eje: 2 }), grupo({ grupoId: "c", eje: 2 })],
      [grupo({ grupoId: "a", eje: 1 }), grupo({ grupoId: "b", eje: 1 })],
      [grupo({ eje: 3 })],
      [grupo({ eje: 2 })],
      [grupo({ tipo: "INCLUIDA", eje: 1 })],
      [grupo({ tipo: "ADICIONAL", eje: 1 })],
      [grupo({ eje: 1, cantidadMinima: 0 })],
      [grupo({ eje: 1, cantidadMaxima: 2 })],
      [grupo({ grupoId: "a", tipo: "MEDIDA", eje: 1 }), grupo({ grupoId: "b", tipo: "MEDIDA", eje: 2 })],
    ]) {
      expect(validarEjesDeCombinacion(grupos), JSON.stringify(grupos.map((g) => [g.tipo, g.eje]))).toMatchObject({ ok: false, codigo: "EJES_INVALIDOS" });
    }
  });
});

describe("identidadDeCombinacion", () => {
  const elegidas = [
    { opcionId: "mediano", grupoId: "tam", esNinguna: false },
    { opcionId: "flat-white", grupoId: "tipo", esNinguna: false },
    { opcionId: "almendras", grupoId: "leche", esNinguna: false },
  ];
  it("toma la opción de cada eje; sin ejes, sin la opción de un eje o con la «ninguna», no hay combinación", () => {
    expect(identidadDeCombinacion({ eje1: "tam", eje2: "tipo" }, elegidas)).toEqual({ opcionEje1Id: "mediano", opcionEje2Id: "flat-white" });
    expect(identidadDeCombinacion({ eje1: "tam", eje2: null }, elegidas)).toEqual({ opcionEje1Id: "mediano", opcionEje2Id: null });
    expect(identidadDeCombinacion({ eje1: null, eje2: null }, elegidas)).toBeNull();
    expect(identidadDeCombinacion({ eje1: "tam", eje2: "otro" }, elegidas)).toBeNull();
    expect(identidadDeCombinacion({ eje1: "tam", eje2: "tipo" }, [elegidas[0]!, { opcionId: "ninguna", grupoId: "tipo", esNinguna: true }])).toBeNull();
  });
});

describe("resolverPrecioDeCombinacion: la precedencia", () => {
  it("sin fila: SIN_COMBINACION (rige el aditivo y no hay foto); con fila sin precio: ADITIVO", () => {
    expect(resolverPrecioDeCombinacion(null, sinLocales, "Café")).toEqual({ ok: true, origen: "SIN_COMBINACION" });
    expect(resolverPrecioDeCombinacion(comb(), sinLocales, "Café")).toEqual({ ok: true, origen: "ADITIVO", combinacionId: "c1" });
  });

  it("el flat white chico (inactivo) no se vende: COMBINACION_NO_DISPONIBLE, aunque tenga precio o precio local", () => {
    expect(resolverPrecioDeCombinacion(comb({ activa: false, precio: 4000 }), { deLaCombinacion: 4100, delGrupo: null }, "Café")).toEqual({
      ok: false,
      codigo: "COMBINACION_NO_DISPONIBLE",
      mensaje: "Esa combinación de «Café» no está disponible.",
    });
  });

  it("la tarifa del grupo; el precio propio; y el precio local le gana a los dos", () => {
    expect(resolverPrecioDeCombinacion(comb({ grupo: tarifa }), sinLocales, "Café")).toEqual({ ok: true, origen: "GRUPO", combinacionId: "c1", precio: 3300, precioDeSucursal: false, grupoDePrecioId: "gp-mediano", nombreGrupoDePrecio: "Café mediano" });
    expect(resolverPrecioDeCombinacion(comb({ grupo: tarifa }), { deLaCombinacion: 9999, delGrupo: 3500 }, "Café")).toMatchObject({ origen: "GRUPO", precio: 3500, precioDeSucursal: true });
    expect(resolverPrecioDeCombinacion(comb({ precio: 4200 }), sinLocales, "Café")).toEqual({ ok: true, origen: "PROPIO", combinacionId: "c1", precio: 4200, precioDeSucursal: false });
    expect(resolverPrecioDeCombinacion(comb({ precio: 4200 }), { deLaCombinacion: 4400, delGrupo: 1 }, "Café")).toEqual({ ok: true, origen: "PROPIO", combinacionId: "c1", precio: 4400, precioDeSucursal: true });
    expect(resolverPrecioDeCombinacion(comb(), { deLaCombinacion: 3900, delGrupo: null }, "Café"), "un local sobre una combinación aditiva").toMatchObject({ origen: "PROPIO", precio: 3900, precioDeSucursal: true });
  });

  it("falla cerrado: un grupo inactivo (no disponible), precio y grupo a la vez, o un precio que no cumple el CHECK", () => {
    expect(resolverPrecioDeCombinacion(comb({ grupo: { ...tarifa, activo: false } }), sinLocales, "Café")).toMatchObject({ ok: false, codigo: "COMBINACION_NO_DISPONIBLE" });
    expect(resolverPrecioDeCombinacion(comb({ grupo: tarifa, precio: 1 }), sinLocales, "Café")).toMatchObject({ ok: false, codigo: "PRECIO_DE_COMBINACION_INVALIDO" });
    for (const malo of [0, -1, 0.001, Number.NaN, 1e13]) expect(resolverPrecioDeCombinacion(comb({ precio: malo }), sinLocales, "Café"), String(malo)).toMatchObject({ ok: false, codigo: "PRECIO_DE_COMBINACION_INVALIDO" });
  });

  it("paridad: los orígenes que se fotografían son exactamente los del CHECK de `CombinacionEnLinea.origenPrecio`", () => {
    expect([...ORIGENES_DE_PRECIO_DE_COMBINACION]).toEqual(["ADITIVO", "PROPIO", "GRUPO"]);
  });
});

describe("entradaConPrecioDeCombinacion + componerPrecioDeLinea (que no se toca)", () => {
  it("sin combinación o con una aditiva, la entrada es LA MISMA (paridad exacta con el precio aditivo de hoy)", () => {
    const e = entradaDeHoy();
    expect(entradaConPrecioDeCombinacion(e, { ok: true, origen: "SIN_COMBINACION" }, EJES)).toBe(e);
    expect(entradaConPrecioDeCombinacion(e, { ok: true, origen: "ADITIVO", combinacionId: "c1" }, EJES)).toBe(e);
    const r = componerPrecioDeLinea(e);
    expect(r.ok && r.precio.precioDeLista).toBe(4500); // 3000 + 300 + 900 + 10 % de 3000
  });

  it("con precio P: la lista es P + lo de las opciones que no son eje, el porcentaje de la que no es eje se calcula sobre P, y la MEDIDA del eje queda «ABSOLUTO P» (la VARIANTE del eje, en 0)", () => {
    const precio = resolverPrecioDeCombinacion(comb({ precio: 4200 }), sinLocales, "Café");
    const transformada = entradaConPrecioDeCombinacion(entradaDeHoy(), precio, EJES);
    const r = componerPrecioDeLinea(transformada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precio.precioDeLista).toBe(4620); // 4200 + 10 % de 4200
    expect(r.precio.importeDelProducto).toBe(9240);
    const detalle = Object.fromEntries(r.precio.dentroDelPrecio.map((d) => [d.opcionId, d]));
    expect(detalle.mediano).toMatchObject({ modoPrecio: "ABSOLUTO", importeUnitario: 4200, tipoDeDiferencia: null, factorEscala: 1.5, precioDeSucursal: false });
    expect(detalle["flat-white"]).toMatchObject({ importeUnitario: 0, tipoDeDiferencia: null });
    expect(detalle.almendras).toMatchObject({ importeUnitario: 420, tipoDeDiferencia: "PORCENTAJE", porcentaje: 10 });
  });

  it("la tarifa del grupo con el precio local: el cortado mediano de la sucursal cobra $ 3.500 (sin opciones que no sean eje)", () => {
    const precio = resolverPrecioDeCombinacion(comb({ grupo: tarifa }), { deLaCombinacion: null, delGrupo: 3500 }, "Café");
    const entrada: EntradaDePrecioDeLinea = { precioBase: 3000, cantidad: 1, opciones: [opcion("mediano", "MEDIDA", { modoPrecio: "DIFERENCIA", diferencia: { tipo: "MONTO", monto: 300 } }), opcion("cortado", "VARIANTE")] };
    const r = componerPrecioDeLinea(entradaConPrecioDeCombinacion(entrada, precio, ["mediano", "cortado"]));
    expect(r.ok && r.precio.precioDeLista).toBe(3500);
  });

  it("con dos ejes VARIANTE (sin MEDIDA eje), P reemplaza al precio base y las variantes del eje van en 0; una MEDIDA que no es eje se cobra como siempre", () => {
    const precio = resolverPrecioDeCombinacion(comb({ precio: 5000 }), sinLocales, "Té");
    const entrada: EntradaDePrecioDeLinea = {
      precioBase: 2000,
      cantidad: 1,
      opciones: [opcion("verde", "VARIANTE", { diferencia: { tipo: "MONTO", monto: 100 } }), opcion("hebras", "VARIANTE", { diferencia: { tipo: "MONTO", monto: 200 } }), opcion("grande", "MEDIDA", { modoPrecio: "DIFERENCIA", diferencia: { tipo: "MONTO", monto: 500 } })],
    };
    const r = componerPrecioDeLinea(entradaConPrecioDeCombinacion(entrada, precio, ["verde", "hebras"]));
    expect(r.ok && r.precio.precioDeLista).toBe(5500);
  });
});
