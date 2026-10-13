import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { armarLineaConfigurada, type GrupoParaVender, type OpcionParaVender } from "../../../src/core/pos/linea-configurada";
import { importeDeLinea, totalDeLineas } from "../../../src/core/moneda";
import { versionVigente } from "../../../src/core/opciones/public";

/**
 * GO-2b (ADR-030): `armarLineaConfigurada`, la línea del producto con sus opciones al pedirlo. Pura: el catálogo de café de los tests de GO-1 armado en memoria
 * (MEDIDA «Tamaño» en DIFERENCIA, VARIANTE «Leche», INCLUIDA «Viene con» y ADICIONAL «Extras» con su producto ancla). Lo que fija: la suma de las partes es el
 * total al centavo; la huella no depende del orden; el adicional nunca tiene descuento; el descuento va sobre la lista compuesta; las cuatro «ninguna»; la
 * prioridad grilla de la sucursal > producto > versión; `modoPrecio` NULL hace fallar la venta.
 */

const monto = (m: number) => ({ tipo: "MONTO" as const, monto: m });

function opcion(opcionId: string, nombre: string, orden: number, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre,
    orden,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 3,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: monto(0),
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}

function cafe(opciones: { modoPrecio?: GrupoParaVender["modoPrecio"]; medida?: Partial<Record<"chico" | "grande", Partial<OpcionParaVender>>> } = {}): GrupoParaVender[] {
  const modoPrecio = opciones.modoPrecio === undefined ? "DIFERENCIA" : opciones.modoPrecio;
  return [
    {
      grupoId: "g-tam",
      nombre: "Tamaño",
      tipo: "MEDIDA",
      activo: true,
      admitido: true,
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      modoPrecio,
      opciones: [
        opcion("chico", "Chico", 1, { diferenciaDeLaVersion: monto(-50), factorEscala: 0.5, ...opciones.medida?.chico }),
        opcion("mediano", "Mediano", 2, { factorEscala: 1 }),
        opcion("grande", "Grande", 3, { diferenciaDeLaVersion: monto(100), factorEscala: 1.5, ...opciones.medida?.grande }),
        opcion("medida-ninguna", "Sin tamaño", 4, { esNinguna: true }),
      ],
    },
    {
      grupoId: "g-leche",
      nombre: "Leche",
      tipo: "VARIANTE",
      activo: true,
      admitido: true,
      cantidadMinima: 0,
      cantidadMaxima: 1,
      orden: 1,
      modoPrecio: null,
      opciones: [
        opcion("vaca", "De vaca", 1),
        opcion("almendras", "Almendras", 2, {
          diferenciaDeLaVersion: monto(150),
          consumos: [{ efecto: "REEMPLAZA", insumoProductoId: "mp-almendras", reemplazaAProductoId: "mp-leche", cantidad: 0.2, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: true }],
        }),
        opcion("leche-ninguna", "Sin leche", 3, { esNinguna: true, diferenciaDeLaVersion: monto(30) }),
      ],
    },
    {
      grupoId: "g-viene",
      nombre: "Viene con",
      tipo: "INCLUIDA",
      activo: true,
      admitido: true,
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 2,
      modoPrecio: null,
      opciones: [opcion("azucar", "Azúcar", 1), opcion("viene-ninguna", "Sin nada", 2, { esNinguna: true })],
    },
    {
      grupoId: "g-extras",
      nombre: "Extras",
      tipo: "ADICIONAL",
      activo: true,
      admitido: true,
      cantidadMinima: 0,
      cantidadMaxima: 3,
      orden: 3,
      modoPrecio: null,
      opciones: [
        opcion("shot", "Shot extra", 1, {
          productoAnclaId: "ancla-shot",
          diferenciaDeLaVersion: monto(200),
          consumos: [{ efecto: "SUMA", insumoProductoId: "mp-cafe", reemplazaAProductoId: null, cantidad: 0.01, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: false }],
        }),
        opcion("extras-ninguna", "Sin extras", 2, { esNinguna: true }),
      ],
    },
  ];
}

const ver = (opcionId: string, cantidad = 1) => ({ opcionId, cantidad, versionDeOpcionId: `v-${opcionId}` });

function armar(elegidas: { opcionId: string; cantidad: number; versionDeOpcionId?: string }[], extra: { grupos?: GrupoParaVender[]; descuento?: number | null; cantidad?: number; precioBase?: number } = {}) {
  return armarLineaConfigurada({ grupos: extra.grupos ?? cafe(), elegidas, precioBase: extra.precioBase ?? 1000, descuentoDeProducto: extra.descuento ?? null, cantidad: extra.cantidad ?? 1 });
}

describe("armarLineaConfigurada (GO-2b)", () => {
  it("café grande con almendras, azúcar y dos shots: precio compuesto, foto, huella y el adicional en su línea", () => {
    const r = armar([ver("grande"), ver("almendras"), ver("azucar"), ver("shot", 2)], { cantidad: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.linea) throw new Error("debería armarse");
    expect(r.linea.precioUnitario).toBe(1250);
    expect(r.linea.precioCartaUnitario).toBeNull();
    expect(r.linea.huellaOpciones).toMatch(/^[0-9a-f]{64}$/);
    expect(r.linea.fotos.map((f) => [f.opcionId, f.tipoGrupo, f.importeUnitario, f.modoPrecio, f.factorEscala, f.orden])).toEqual([
      ["grande", "MEDIDA", 100, "DIFERENCIA", 1.5, 0],
      ["almendras", "VARIANTE", 150, null, null, 1],
      ["azucar", "INCLUIDA", 0, null, null, 2],
    ]);
    expect(r.linea.adicionales).toEqual([
      {
        opcionId: "shot",
        productoId: "ancla-shot",
        cantidadPorUnidad: 2,
        cantidad: 4,
        precioUnitario: 200,
        foto: expect.objectContaining({ tipoGrupo: "ADICIONAL", cantidad: 2, importeUnitario: 200, tipoDeDiferencia: "MONTO", orden: 3 }),
      },
    ]);
  });

  it("la suma de las partes es el total exacto, al centavo (propiedad, con descuento de producto y cantidades distintas)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 999_999 }).map((c) => c / 100),
        fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
        (cantidad, shots, precioBase, descuento) => {
          const r = armar([ver("chico"), ver("almendras"), ver("azucar"), ver("shot", shots)], { cantidad, precioBase: precioBase + 50, descuento });
          if (!r.ok || !r.linea) throw new Error(`debería armarse: ${JSON.stringify(r)}`);
          const lista = r.linea.precioCartaUnitario ?? r.linea.precioUnitario;
          // Sin descuento: la lista compuesta es base + medida + variante (la incluida suma 0), un solo redondeo.
          expect(lista).toBe(totalDeLineas([{ cantidad: 1, precioUnitario: precioBase + 50 }, { cantidad: 1, precioUnitario: -50 }, { cantidad: 1, precioUnitario: 150 }]));
          const partes = importeDeLinea(cantidad, r.linea.precioUnitario) + r.linea.adicionales.reduce((s, a) => s + importeDeLinea(a.cantidad, a.precioUnitario), 0);
          expect(totalDeLineas([{ cantidad, precioUnitario: r.linea.precioUnitario }, ...r.linea.adicionales.map((a) => ({ cantidad: a.cantidad, precioUnitario: a.precioUnitario }))])).toBeCloseTo(partes, 9);
          expect(r.linea.adicionales[0]!.cantidad).toBe(cantidad * shots);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("la huella no depende del orden en que llegan las opciones; otra versión u otra opción la cambian", () => {
    const a = armar([ver("grande"), ver("almendras"), ver("azucar")]);
    const b = armar([ver("azucar"), ver("almendras"), ver("grande")]);
    const c = armar([ver("grande"), ver("vaca"), ver("azucar")]);
    if (!a.ok || !b.ok || !c.ok) throw new Error("deberían armarse");
    expect(a.linea!.huellaOpciones).toBe(b.linea!.huellaOpciones);
    expect(a.linea!.fotos).toEqual(b.linea!.fotos);
    expect(c.linea!.huellaOpciones).not.toBe(a.linea!.huellaOpciones);
  });

  it("el descuento de producto se aplica sobre la LISTA COMPUESTA y el adicional nunca lo lleva", () => {
    const r = armar([ver("grande"), ver("almendras"), ver("azucar"), ver("shot")], { descuento: 10 });
    if (!r.ok || !r.linea) throw new Error("debería armarse");
    expect(r.linea.precioCartaUnitario).toBe(1250);
    expect(r.linea.precioUnitario).toBe(1125);
    expect(r.linea.adicionales[0]!.precioUnitario).toBe(200);
  });

  it("la «ninguna»: en VARIANTE e INCLUIDA va a la foto con importe 0 (aunque la versión tenga diferencia); en ADICIONAL cuenta y no genera nada; en MEDIDA es inválida", () => {
    const r = armar([ver("mediano"), ver("leche-ninguna"), ver("viene-ninguna"), ver("extras-ninguna")]);
    if (!r.ok || !r.linea) throw new Error("debería armarse");
    expect(r.linea.precioUnitario).toBe(1000);
    expect(r.linea.fotos.map((f) => [f.opcionId, f.importeUnitario, f.tipoDeDiferencia])).toEqual([
      ["mediano", 0, "MONTO"],
      ["leche-ninguna", 0, null],
      ["viene-ninguna", 0, null],
    ]);
    expect(r.linea.adicionales).toEqual([]);

    const conMinimo = cafe();
    conMinimo[3] = { ...conMinimo[3]!, cantidadMinima: 1 };
    const soloNingunaDeExtras = armar([ver("mediano"), ver("azucar"), ver("extras-ninguna")], { grupos: conMinimo });
    expect(soloNingunaDeExtras.ok).toBe(true);
    expect(armar([ver("mediano"), ver("azucar")], { grupos: conMinimo })).toMatchObject({ ok: false, codigo: "GRUPO_MINIMO_NO_ALCANZADO" });

    expect(armar([ver("medida-ninguna"), ver("azucar")])).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
  });

  it("prioridad del precio: en una MEDIDA en ABSOLUTO la grilla de la sucursal le gana al precio del producto; en DIFERENCIA la del producto le gana a la de la versión", () => {
    const absoluto = cafe({ modoPrecio: "ABSOLUTO", medida: { grande: { precioAbsoluto: 1400, precioDeSucursal: 1500 }, chico: { precioAbsoluto: 800 } } });
    const conGrilla = armar([ver("grande"), ver("azucar")], { grupos: absoluto });
    if (!conGrilla.ok || !conGrilla.linea) throw new Error("debería armarse");
    expect(conGrilla.linea.precioUnitario).toBe(1500);
    expect(conGrilla.linea.fotos[0]).toMatchObject({ modoPrecio: "ABSOLUTO", importeUnitario: 1500, precioDeSucursal: true, tipoDeDiferencia: null });
    const sinGrilla = armar([ver("chico"), ver("azucar")], { grupos: absoluto });
    if (!sinGrilla.ok || !sinGrilla.linea) throw new Error("debería armarse");
    expect(sinGrilla.linea.precioUnitario).toBe(800);
    expect(sinGrilla.linea.fotos[0]).toMatchObject({ importeUnitario: 800, precioDeSucursal: false });

    const delProducto = armar([ver("grande"), ver("azucar")], { grupos: cafe({ medida: { grande: { diferenciaDelProducto: { tipo: "PORCENTAJE", porcentaje: 20 } } } }) });
    if (!delProducto.ok || !delProducto.linea) throw new Error("debería armarse");
    expect(delProducto.linea.precioUnitario).toBe(1200);
    expect(delProducto.linea.fotos[0]).toMatchObject({ tipoDeDiferencia: "PORCENTAJE", porcentaje: 20, importeUnitario: 200 });
  });

  it("`modoPrecio` NULL en la MEDIDA hace fallar la venta (PRECIO_DE_OPCION_INVALIDO)", () => {
    expect(armar([ver("grande"), ver("azucar")], { grupos: cafe({ modoPrecio: null }) })).toMatchObject({ ok: false, codigo: "PRECIO_DE_OPCION_INVALIDO" });
  });

  it("sin nada elegido ni obligatorio no hay línea configurada (se pide como siempre); con un obligatorio sin elegir, falla", () => {
    const sinObligatorios = cafe().filter((g) => g.cantidadMinima === 0);
    expect(armar([], { grupos: sinObligatorios })).toEqual({ ok: true, linea: null });
    expect(armar([])).toMatchObject({ ok: false, codigo: "GRUPO_MINIMO_NO_ALCANZADO" });
    expect(armar([ver("shot")], { grupos: [] })).toMatchObject({ ok: false, codigo: "OPCIONES_NO_ADMITIDAS" });
  });

  it("los errores tipados de la validación, el precio y el consumo llegan tal cual", () => {
    expect(armar([{ opcionId: "grande", cantidad: 1, versionDeOpcionId: "otra" }, ver("azucar")])).toMatchObject({ ok: false, codigo: "OPCION_CAMBIO" });
    expect(armar([ver("grande"), ver("azucar")], { cantidad: 1.5 })).toMatchObject({ ok: false, codigo: "CANTIDAD_INVALIDA" });
    const incompatibles = cafe();
    incompatibles[2] = {
      ...incompatibles[2]!,
      opciones: [
        opcion("azucar", "Azúcar", 1, { consumos: [{ efecto: "REEMPLAZA", insumoProductoId: "mp-otra", reemplazaAProductoId: "mp-leche", cantidad: 0.1, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: false }] }),
      ],
    };
    expect(armar([ver("grande"), ver("almendras"), ver("azucar")], { grupos: incompatibles })).toMatchObject({ ok: false, codigo: "OPCIONES_INCOMPATIBLES" });
    const malDefinido = cafe();
    malDefinido[3] = {
      ...malDefinido[3]!,
      opciones: [opcion("shot", "Shot extra", 1, { productoAnclaId: "ancla", diferenciaDeLaVersion: monto(200), consumos: [{ efecto: "SUMA", insumoProductoId: "mp", reemplazaAProductoId: null, cantidad: 1, unidadStockId: "u", mermaPorcentaje: 0, escalaConLaMedida: true }] })],
    };
    expect(armar([ver("grande"), ver("azucar"), ver("shot")], { grupos: malDefinido })).toMatchObject({ ok: false, codigo: "CONSUMO_INVALIDO" });
    const sinAncla = cafe();
    sinAncla[3] = { ...sinAncla[3]!, opciones: [opcion("shot", "Shot extra", 1, { diferenciaDeLaVersion: monto(200) })] };
    expect(armar([ver("grande"), ver("azucar"), ver("shot")], { grupos: sinAncla })).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
  });
});

describe("versionVigente (GO-2b)", () => {
  it("es la de número mayor, sin importar el orden; sin versiones, null", () => {
    expect(versionVigente([{ id: "a", numero: 1 }, { id: "c", numero: 3 }, { id: "b", numero: 2 }])).toEqual({ id: "c", numero: 3 });
    expect(versionVigente([])).toBeNull();
  });
});
