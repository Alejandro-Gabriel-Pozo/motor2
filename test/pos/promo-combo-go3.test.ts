import { describe, expect, it } from "vitest";
import {
  claveDeComponenteConfigurado,
  claveDeConfiguracion,
  esCupoFijo,
  prorratearPrecioPromo,
  totalProrrateado,
  validarYAplanarEleccionPromo,
  type CupoDeEntradasDefinicion,
  type CupoDePromo,
  type EntradaElegibleDeCupo,
} from "../../src/core/pos/promo-combo";

/**
 * GO-3 (ADR-032), paso D1: los cupos de ENTRADAS (LISTA y DEL_DIA) en el núcleo puro de las promos: el completado de los componentes fijos por el servidor, el rechazo de lo que el cliente no
 * puede elegir, el menú del día sin cargar (falla cerrado), la clave estable de una configuración y los dos ejemplos del diseño exactos al centavo.
 * Mutaciones demostradas: sacar el completado de fijos (caen «el fijo se completa solo» y los ejemplos) y sacar el chequeo del DEL_DIA vacío (cae «sin plato de hoy»).
 */

const entrada = (entradaId: string, productoId: string, claveComponente = productoId): [string, EntradaElegibleDeCupo] => [entradaId, { entradaId, productoId, claveComponente }];
function lista(over: Partial<CupoDeEntradasDefinicion> & { entradas: Map<string, EntradaElegibleDeCupo> }): CupoDeEntradasDefinicion {
  return { cupoId: "cupo-lista", tipo: "LISTA", nombre: "Entrada", cantidadMinima: 1, cantidadMaximaCupo: 1, ...over };
}

describe("los componentes fijos", () => {
  const flan = lista({ cupoId: "cupo-postre", nombre: "Postre", entradas: new Map([entrada("e-flan", "flan")]) });

  it("un LISTA con una sola entrada y mínimo = máximo es fijo; con dos entradas, con rango o con mínimo 0, no", () => {
    expect(esCupoFijo(flan)).toBe(true);
    expect(esCupoFijo(lista({ entradas: new Map([entrada("a", "a"), entrada("b", "b")]) }))).toBe(false);
    expect(esCupoFijo(lista({ entradas: new Map([entrada("a", "a")]), cantidadMaximaCupo: 2 }))).toBe(false);
    expect(esCupoFijo(lista({ entradas: new Map([entrada("a", "a")]), cantidadMinima: 0, cantidadMaximaCupo: 0 }))).toBe(false);
    expect(esCupoFijo({ ...flan, tipo: "DEL_DIA" })).toBe(false);
    expect(esCupoFijo({ seccionCartaId: "s", nombreSeccion: "S", cantidadMinima: 1, cantidadMaximaCupo: 1, elegibles: new Set(["x"]) })).toBe(false);
  });

  it("el servidor completa el fijo solo (el cliente no manda nada) con su entrada y su cantidad", () => {
    const dos = lista({ cupoId: "cupo-medialunas", nombre: "Medialunas", cantidadMinima: 2, cantidadMaximaCupo: 2, entradas: new Map([entrada("e-medialuna", "medialuna")]) });
    expect(validarYAplanarEleccionPromo([flan, dos], [])).toEqual({
      ok: true,
      componentes: [
        { productoId: "flan", cantidad: 1, entradaId: "e-flan", claveComponente: "flan" },
        { productoId: "medialuna", cantidad: 2, entradaId: "e-medialuna", claveComponente: "medialuna" },
      ],
    });
  });

  it("si el cliente manda para el fijo exactamente lo fijado, pasa; si manda otra cosa (otra cantidad, otra entrada, de más), se rechaza: nunca se cobra distinto de lo que fijó el dueño", () => {
    expect(validarYAplanarEleccionPromo([flan], [{ cupoId: "cupo-postre", elegidos: [{ entradaId: "e-flan", cantidad: 1 }] }]).ok).toBe(true);
    for (const elegidos of [[{ entradaId: "e-flan", cantidad: 2 }], [{ entradaId: "otra", cantidad: 1 }], [], [{ entradaId: "e-flan", cantidad: 1 }, { entradaId: "e-flan", cantidad: 1 }]]) {
      expect(validarYAplanarEleccionPromo([flan], [{ cupoId: "cupo-postre", elegidos }]), JSON.stringify(elegidos)).toMatchObject({ ok: false, codigo: "COMPONENTE_FIJO" });
    }
  });
});

describe("las entradas elegibles y el menú del día", () => {
  const entradas = lista({ entradas: new Map([entrada("e-sopa", "sopa"), entrada("e-ensalada", "ensalada")]) });
  const delDia = (platos: [string, EntradaElegibleDeCupo][], cantidadMinima = 1): CupoDeEntradasDefinicion => ({
    cupoId: "cupo-dia",
    tipo: "DEL_DIA",
    nombre: "Plato del día",
    cantidadMinima,
    cantidadMaximaCupo: 1,
    entradas: new Map(platos),
  });

  it("una entrada que no está entre las elegibles de hoy se rechaza (se desactivó, se quitó del día o ya no tiene origen de stock)", () => {
    expect(validarYAplanarEleccionPromo([entradas], [{ cupoId: "cupo-lista", elegidos: [{ entradaId: "e-guiso", cantidad: 1 }] }])).toMatchObject({ ok: false, codigo: "ENTRADA_NO_DISPONIBLE" });
  });

  it("un DEL_DIA sin ningún plato para hoy y con mínimo > 0 no se arma (falla cerrado, nunca el plato de ayer); con mínimo 0, el lugar queda vacío", () => {
    expect(validarYAplanarEleccionPromo([delDia([])], [])).toEqual({ ok: false, codigo: "MENU_DEL_DIA_SIN_CARGAR", mensaje: "«Plato del día»: todavía no se cargó el plato de hoy." });
    expect(validarYAplanarEleccionPromo([delDia([], 0)], [])).toEqual({ ok: true, componentes: [] });
    expect(validarYAplanarEleccionPromo([delDia([entrada("d-mila", "milanesa")])], [{ cupoId: "cupo-dia", elegidos: [{ entradaId: "d-mila", cantidad: 1 }] }])).toEqual({
      ok: true,
      componentes: [{ productoId: "milanesa", cantidad: 1, entradaId: "d-mila", claveComponente: "milanesa" }],
    });
  });

  it("mínimo, máximo, cantidad entera y sin repetir, como en un cupo de sección; un lugar que no es de la promo o repetido se rechaza", () => {
    const elegir = (elegidos: { entradaId: string; cantidad: number }[]) => validarYAplanarEleccionPromo([entradas], [{ cupoId: "cupo-lista", elegidos }]);
    expect(elegir([]).ok).toBe(false);
    expect(elegir([{ entradaId: "e-sopa", cantidad: 1 }, { entradaId: "e-ensalada", cantidad: 1 }]).ok).toBe(false);
    expect(elegir([{ entradaId: "e-sopa", cantidad: 1.5 }]).ok).toBe(false);
    expect(elegir([{ entradaId: "e-sopa", cantidad: 0 }]).ok).toBe(false);
    expect(validarYAplanarEleccionPromo([{ ...entradas, cantidadMaximaCupo: 2 }], [{ cupoId: "cupo-lista", elegidos: [{ entradaId: "e-sopa", cantidad: 1 }, { entradaId: "e-sopa", cantidad: 1 }] }]).ok).toBe(false);
    expect(validarYAplanarEleccionPromo([entradas], [{ cupoId: "otro-cupo", elegidos: [] }])).toEqual({ ok: false, mensaje: "La elección incluye un lugar que no es parte de esta promo." });
    const dos = [{ cupoId: "cupo-lista", elegidos: [{ entradaId: "e-sopa", cantidad: 1 }] }, { cupoId: "cupo-lista", elegidos: [] }];
    expect(validarYAplanarEleccionPromo([entradas], dos).ok).toBe(false);
    // Una elección por sección contra un cupo de entradas no cuenta para él (el mínimo no se cumple) y la sección no es de la promo.
    expect(validarYAplanarEleccionPromo([entradas], [{ seccionCartaId: "cupo-lista", elegidos: [{ productoId: "sopa", cantidad: 1 }] }]).ok).toBe(false);
  });
});

describe("la clave estable de una configuración fija", () => {
  it("es el canónico ordenado `opcionId=cantidad;…`, sin depender del orden; vacío sin opciones; null si es inválida", () => {
    expect(claveDeConfiguracion([])).toBe("");
    expect(claveDeConfiguracion([{ opcionId: "op-leche", cantidad: 1 }, { opcionId: "op-mediano", cantidad: 1 }])).toBe("op-leche=1;op-mediano=1");
    expect(claveDeConfiguracion([{ opcionId: "op-mediano", cantidad: 1 }, { opcionId: "op-leche", cantidad: 1 }])).toBe("op-leche=1;op-mediano=1");
    expect(claveDeConfiguracion([{ opcionId: "shot", cantidad: 10 }])).toBe("shot=10");
    for (const mala of [[{ opcionId: "a", cantidad: 0 }], [{ opcionId: "a", cantidad: 11 }], [{ opcionId: "a", cantidad: 1 }, { opcionId: "a", cantidad: 2 }], [{ opcionId: "a;b", cantidad: 1 }], [{ opcionId: "", cantidad: 1 }]]) {
      expect(claveDeConfiguracion(mala), JSON.stringify(mala)).toBeNull();
    }
    expect(claveDeComponenteConfigurado("cafe", "")).toBe("cafe");
    expect(claveDeComponenteConfigurado("cafe", "op-mediano=1")).toBe("cafe#op-mediano=1");
  });
});

describe("los dos ejemplos del diseño, exactos al centavo", () => {
  it("Menú del día $ 9.500 (sopa $ 3.000, milanesa $ 8.000, agua $ 1.500 y flan fijo $ 2.500): 1.900,00 + 5.066,67 + 950,00 + 1.583,33 = 9.500 exactos", () => {
    const cupos: CupoDePromo[] = [
      lista({ entradas: new Map([entrada("e-sopa", "sopa"), entrada("e-ensalada", "ensalada")]) }),
      { cupoId: "cupo-dia", tipo: "DEL_DIA", nombre: "Plato del día", cantidadMinima: 1, cantidadMaximaCupo: 1, entradas: new Map([entrada("d-mila", "milanesa"), entrada("d-guiso", "guiso")]) },
      { seccionCartaId: "sec-bebidas", nombreSeccion: "Bebidas sin alcohol", cantidadMinima: 1, cantidadMaximaCupo: 1, elegibles: new Set(["agua", "gaseosa"]) },
      lista({ cupoId: "cupo-postre", nombre: "Postre", entradas: new Map([entrada("e-flan", "flan")]) }),
    ];
    const v = validarYAplanarEleccionPromo(cupos, [
      { cupoId: "cupo-lista", elegidos: [{ entradaId: "e-sopa", cantidad: 1 }] },
      { cupoId: "cupo-dia", elegidos: [{ entradaId: "d-mila", cantidad: 1 }] },
      { seccionCartaId: "sec-bebidas", elegidos: [{ productoId: "agua", cantidad: 1 }] },
    ]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const lista_: Record<string, number> = { sopa: 3000, milanesa: 8000, agua: 1500, flan: 2500 };
    const r = prorratearPrecioPromo(9500, v.componentes.map((c) => ({ ...c, precioCarta: lista_[c.productoId]! })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas.map((f) => [f.productoId, f.cantidad, f.precioUnitario])).toEqual([["sopa", 1, 1900], ["milanesa", 1, 5066.67], ["agua", 1, 950], ["flan", 1, 1583.33]]);
    expect(totalProrrateado(r.filas)).toBe(9500);
  });

  it("Combo Desayuno $ 4.000 todo fijo (café con leche mediano $ 3.300 y 2 medialunas $ 800): 2.693,88 + 2 × 653,06 = 4.000 exactos, con un toque (sin elección)", () => {
    const cupos: CupoDePromo[] = [
      lista({ cupoId: "c-cafe", nombre: "Café", entradas: new Map([entrada("e-cafe", "cafe", claveDeComponenteConfigurado("cafe", claveDeConfiguracion([{ opcionId: "mediano", cantidad: 1 }, { opcionId: "leche", cantidad: 1 }])!))]) }),
      lista({ cupoId: "c-medialunas", nombre: "Medialunas", cantidadMinima: 2, cantidadMaximaCupo: 2, entradas: new Map([entrada("e-medialuna", "medialuna")]) }),
    ];
    const v = validarYAplanarEleccionPromo(cupos, []);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = prorratearPrecioPromo(4000, v.componentes.map((c) => ({ ...c, precioCarta: c.productoId === "cafe" ? 3300 : 800 })));
    expect(r).toEqual({
      ok: true,
      filas: [
        { productoId: "cafe", claveComponente: "cafe#leche=1;mediano=1", cantidad: 1, precioUnitario: 2693.88 },
        { productoId: "medialuna", claveComponente: "medialuna", cantidad: 2, precioUnitario: 653.06 },
      ],
    });
    if (r.ok) expect(totalProrrateado(r.filas)).toBe(4000);
  });
});
