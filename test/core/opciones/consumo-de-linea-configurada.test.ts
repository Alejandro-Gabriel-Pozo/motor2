import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rendimientoEfectivo } from "../../../src/core/catalogo/rendimiento-local";
import {
  CODIGOS_DE_ERROR_DE_CONSUMO,
  consumoDeLineaConfigurada,
  type AdicionalConConsumo,
  type ConsumoDeOpcionParaVender,
  type EntradaDeConsumoConfigurado,
  type IngredienteDeBase,
  type OpcionConConsumo,
  type ResultadoDeConsumoConfigurado,
} from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { pedidoDeIngrediente } from "../../../src/core/movimientos/linea-de-venta";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { CAFE, HOTEL, SPA, SUCURSAL, paraConsumo, permitidosDe, type Escenario } from "./escenarios";

/**
 * GO-0b, invariantes I6 e I7 (diseño §5): el consumo de una línea configurada son los MISMOS `pedidos` que arma hoy `armarLinea`. Con factor 1 y sin opciones que toquen la
 * base, el resultado es IDÉNTICO (`Object.is`) al de `pedidoDeIngrediente`. Casos del café (chico, mediano y grande con el vaso reemplazado; cortado que reemplaza la leche; con
 * leche que suma), del hotel y del spa (el aceite escala; el aceite premium reemplaza), y propiedades contra un oráculo con decimal.js.
 */

/**
 * El oráculo de las cuentas con cantidades en `number` de 17 dígitos: decimal.js con 80 dígitos (la configuración global de 20 redondea el producto de tres de esos números
 * y daría un último bit distinto; el módulo usa su propio clon de 40).
 */
const Dec = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });

function ok(r: ResultadoDeConsumoConfigurado) {
  if (!r.ok) throw new Error(`se esperaba un consumo y vino ${r.codigo}: ${r.mensaje}`);
  return r;
}

function falla(r: ResultadoDeConsumoConfigurado) {
  if (r.ok) throw new Error("se esperaba un rechazo y se calculó un consumo");
  expect(r.mensaje.trim().length, `el rechazo ${r.codigo} tiene que traer un mensaje para quien vende`).toBeGreaterThan(10);
  return r;
}

function consumoDelEscenario(escenario: Escenario, ids: Array<string | [string, number]>, cantidad = 1) {
  const elegidas = ids.map((i) => (typeof i === "string" ? { opcionId: i, cantidad: 1 } : { opcionId: i[0], cantidad: i[1] }));
  const validadas = validarOpcionesElegidas(permitidosDe(escenario), elegidas);
  if (!validadas.ok) throw new Error(`la elección no es válida: ${validadas.mensaje}`);
  const { opciones, adicionales } = paraConsumo(escenario, validadas.opciones);
  return consumoDeLineaConfigurada({ cantidad, sucursalId: escenario.sucursalId, base: escenario.base, opciones, adicionales });
}

/** Lo que arma HOY el camino de venta: un pedido por ingrediente de la base, con la fórmula de siempre. */
function pedidosDeHoy(base: readonly IngredienteDeBase[], cantidad: number, sucursalId = SUCURSAL) {
  return base.map((b) => pedidoDeIngrediente(cantidad, b.ingrediente, b.unidadStockId, sucursalId));
}

function identicos(a: ReturnType<typeof pedidosDeHoy>, b: ReturnType<typeof pedidosDeHoy>): boolean {
  return a.length === b.length && a.every((p, i) => p.productoId === b[i].productoId && Object.is(p.cantidad, b[i].cantidad) && p.unidadStockId === b[i].unidadStockId && p.insumoSustitutoIds === b[i].insumoSustitutoIds);
}

describe("consumoDeLineaConfigurada: café", () => {
  it("chico (factor 1), sin nada más: idéntico a lo que arma hoy el camino de venta, bit a bit", () => {
    for (const cantidad of [1, 2, 3, 0.5, 7]) {
      const r = ok(consumoDelEscenario(CAFE, ["o-chico"], cantidad));
      expect(identicos(r.pedidos, pedidosDeHoy(CAFE.base, cantidad)), `cantidad ${cantidad}`).toBe(true);
      expect(r.pedidosDeAdicionales).toEqual([]);
      expect(r.reemplazosSinEfecto).toEqual([]);
    }
  });

  it("chico: grano 10 g, leche 63 ml (60 más 5 % de merma) y vaso chico, con los sustitutos de la leche de la receta", () => {
    const { pedidos } = ok(consumoDelEscenario(CAFE, ["o-chico"]));
    expect(pedidos).toEqual([
      { productoId: "mp-grano", cantidad: 10, insumoSustitutoIds: [], unidadStockId: "u-g" },
      { productoId: "mp-leche", cantidad: 60 * (1 + 5 / 100), insumoSustitutoIds: ["mp-leche-deslactosada"], unidadStockId: "u-ml" },
      { productoId: "mp-vaso-chico", cantidad: 1, insumoSustitutoIds: [], unidadStockId: "u-u" },
    ]);
  });

  it("mediano con leche, 2 cafés: café y leche ×1,5, el vaso NO se multiplica (se reemplaza por uno mediano), y la leche que suma también escala", () => {
    const { pedidos } = ok(consumoDelEscenario(CAFE, ["o-mediano", "o-con-leche"], 2));
    expect(pedidos).toEqual([
      { productoId: "mp-grano", cantidad: 30, insumoSustitutoIds: [], unidadStockId: "u-g" }, // 10 × 1,5 × 2
      { productoId: "mp-leche", cantidad: 189, insumoSustitutoIds: ["mp-leche-deslactosada"], unidadStockId: "u-ml" }, // 60 × 1,05 × 1,5 × 2
      { productoId: "mp-vaso-mediano", cantidad: 2, insumoSustitutoIds: [], unidadStockId: "u-u" }, // 1 × 2, sin factor
      { productoId: "mp-leche", cantidad: 300, insumoSustitutoIds: [], unidadStockId: "u-ml" }, // 100 × 1,5 × 2
    ]);
  });

  it("grande cortado: café ×2, el cortado reemplaza la leche por 30 ml (cantidad absoluta, sin el factor) y el vaso grande reemplaza al chico", () => {
    const { pedidos, reemplazosSinEfecto } = ok(consumoDelEscenario(CAFE, ["o-grande", "o-cortado"]));
    expect(pedidos).toEqual([
      { productoId: "mp-grano", cantidad: 20, insumoSustitutoIds: [], unidadStockId: "u-g" },
      { productoId: "mp-leche", cantidad: 30, insumoSustitutoIds: [], unidadStockId: "u-ml" },
      { productoId: "mp-vaso-grande", cantidad: 1, insumoSustitutoIds: [], unidadStockId: "u-u" },
    ]);
    expect(reemplazosSinEfecto).toEqual([]);
  });

  it("mediano sin lactosa: la leche vegetal reemplaza a la leche y esa sí escala con la medida (60 × 1,5 = 90)", () => {
    const { pedidos } = ok(consumoDelEscenario(CAFE, ["o-mediano", "o-sin-lactosa"]));
    expect(pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
      ["mp-grano", 15],
      ["mp-leche-vegetal", 90],
      ["mp-vaso-mediano", 1],
    ]);
  });

  it("el shot extra es OTRA línea: su consumo (9 g de grano × k × cantidad vendida) sale aparte y la línea del café no lo lleva", () => {
    const r = ok(consumoDelEscenario(CAFE, ["o-mediano", ["o-shot", 2]], 3));
    expect(r.pedidosDeAdicionales).toEqual([{ opcionId: "o-shot", cantidad: 6, pedidos: [{ productoId: "mp-grano", cantidad: 54, insumoSustitutoIds: [], unidadStockId: "u-g" }] }]);
    expect(r.pedidos.find((p) => p.productoId === "mp-grano")?.cantidad).toBe(45); // 10 × 1,5 × 3: el shot no se suma a la línea del café
  });

  it("el resultado no depende del orden en que llegan las opciones (primero la medida, después el resto en el orden de los grupos)", () => {
    const validadas = validarOpcionesElegidas(permitidosDe(CAFE), [
      { opcionId: "o-mediano", cantidad: 1 },
      { opcionId: "o-con-leche", cantidad: 1 },
    ]);
    if (!validadas.ok) throw new Error(validadas.mensaje);
    const { opciones } = paraConsumo(CAFE, validadas.opciones);
    const entrada = (lista: OpcionConConsumo[]) => ({ cantidad: 1, sucursalId: SUCURSAL, base: CAFE.base, opciones: lista, adicionales: [] });
    expect(consumoDeLineaConfigurada(entrada([...opciones].reverse()))).toEqual(consumoDeLineaConfigurada(entrada(opciones)));
  });
});

describe("consumoDeLineaConfigurada: orden de aplicación", () => {
  const con = (opcionId: string, tipo: OpcionConConsumo["tipo"], ordenDeGrupo: number, ordenDeOpcion: number, insumo: string, factorEscala: number | null = null): OpcionConConsumo => ({
    opcionId,
    nombre: opcionId,
    tipo,
    ordenDeGrupo,
    ordenDeOpcion,
    cantidad: 1,
    factorEscala,
    consumos: [suma(insumo, 1)],
  });
  const ordenDe = (opciones: OpcionConConsumo[]) => ok(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: [], opciones, adicionales: [] })).pedidos.map((p) => p.productoId);

  it("primero la MEDIDA, aunque su grupo vaya después en la pantalla, y después el resto en el orden de los grupos", () => {
    const variante = con("v", "VARIANTE", 0, 0, "mp-variante");
    const incluida = con("i", "INCLUIDA", 1, 0, "mp-incluida");
    const medida = con("m", "MEDIDA", 2, 0, "mp-medida", 1);
    for (const entrada of [[variante, incluida, medida], [medida, incluida, variante], [incluida, medida, variante], [variante, medida, incluida]]) {
      expect(ordenDe(entrada)).toEqual(["mp-medida", "mp-variante", "mp-incluida"]);
    }
  });

  it("dentro de un grupo, por el orden de la opción; con todo igual, por el id de la opción (nunca por el orden en que llegaron)", () => {
    const a = con("a", "VARIANTE", 1, 0, "mp-a");
    const b = con("b", "VARIANTE", 1, 0, "mp-b");
    const c = con("c", "VARIANTE", 1, 0, "mp-c");
    const primera = con("z", "VARIANTE", 1, -1, "mp-z");
    for (const entrada of [[a, b, c], [c, b, a], [b, c, a], [c, a, b], [a, c, b], [b, a, c]]) expect(ordenDe([...entrada, primera])).toEqual(["mp-z", "mp-a", "mp-b", "mp-c"]);
  });

  it("con muchas opciones empatadas en orden, el desempate por id las deja siempre igual (propiedad)", () => {
    const ids = fc.uniqueArray(fc.stringMatching(/^o-[a-z0-9]{1,4}$/), { minLength: 2, maxLength: 14 });
    fc.assert(
      fc.property(
        ids.chain((lista) => fc.tuple(fc.constant(lista), fc.shuffledSubarray(lista, { minLength: lista.length, maxLength: lista.length }))),
        ([lista, barajada]) => {
          const opciones = barajada.map((id) => con(id, "VARIANTE", 1, 0, `mp-${id}`));
          expect(ordenDe(opciones)).toEqual([...lista].sort((a, b) => (a < b ? -1 : 1)).map((id) => `mp-${id}`));
        }
      ),
      { numRuns: 300 }
    );
  });

  it("un rechazo que no es de una opción no lleva opcionId (ni siquiera como undefined)", () => {
    expect(Object.keys(falla(consumoDeLineaConfigurada({ cantidad: 0, sucursalId: SUCURSAL, base: [], opciones: [], adicionales: [] }))).sort()).toEqual(["codigo", "mensaje", "ok"]);
  });
});

describe("consumoDeLineaConfigurada: reemplazos", () => {
  it("cortado + sin lactosa (las dos reemplazan la leche) → OPCIONES_INCOMPATIBLES con las dos nombradas, se elijan en el orden que se elijan", () => {
    const sinLactosa = CAFE.opciones.find((o) => o.opcionId === "o-sin-lactosa")!;
    const cortado = CAFE.opciones.find((o) => o.opcionId === "o-cortado")!;
    const opcion = (def: typeof cortado, orden: number): OpcionConConsumo => ({ opcionId: def.opcionId, nombre: def.nombre, tipo: "VARIANTE", ordenDeGrupo: 1, ordenDeOpcion: orden, cantidad: 1, factorEscala: null, consumos: def.consumos ?? [] });
    for (const opciones of [[opcion(cortado, 0), opcion(sinLactosa, 2)], [opcion(sinLactosa, 2), opcion(cortado, 0)]]) {
      const r = falla(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: CAFE.base, opciones, adicionales: [] }));
      expect(r).toMatchObject({ codigo: "OPCIONES_INCOMPATIBLES", opcionId: "o-sin-lactosa" });
      expect(r.mensaje).toBe("«Cortado» y «Sin lactosa» no se pueden elegir juntas: las dos cambian el mismo insumo.");
    }
  });

  it("dos reemplazos del mismo insumo dentro de UNA opción también son incompatibles", () => {
    const doble: OpcionConConsumo = {
      opcionId: "o-doble",
      nombre: "Doble",
      tipo: "VARIANTE",
      ordenDeGrupo: 1,
      ordenDeOpcion: 0,
      cantidad: 1,
      factorEscala: null,
      consumos: [reemplazo("mp-leche", "mp-a", 1), reemplazo("mp-leche", "mp-b", 1)],
    };
    expect(falla(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: CAFE.base, opciones: [doble], adicionales: [] })).codigo).toBe("OPCIONES_INCOMPATIBLES");
  });

  it("un reemplazo de un insumo que NO está en la base no aplica: no quita ni agrega nada y queda registrado", () => {
    const sinLeche = CAFE.base.filter((b) => b.ingrediente.insumoProductoId !== "mp-leche");
    const validadas = validarOpcionesElegidas(permitidosDe(CAFE), [
      { opcionId: "o-chico", cantidad: 1 },
      { opcionId: "o-cortado", cantidad: 1 },
    ]);
    if (!validadas.ok) throw new Error(validadas.mensaje);
    const { opciones, adicionales } = paraConsumo(CAFE, validadas.opciones);
    const r = ok(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base: sinLeche, opciones, adicionales }));
    expect(r.pedidos.map((p) => p.productoId)).toEqual(["mp-grano", "mp-vaso-chico"]);
    expect(r.reemplazosSinEfecto).toEqual([{ opcionId: "o-cortado", reemplazaAProductoId: "mp-leche" }]);
  });

  it("si la base trae el mismo insumo en dos líneas, el reemplazo va una sola vez, en el lugar de la primera", () => {
    const base = [CAFE.base[0], CAFE.base[1], { ...CAFE.base[1] }, CAFE.base[2]];
    const cortado = CAFE.opciones.find((o) => o.opcionId === "o-cortado")!;
    const opcion: OpcionConConsumo = { opcionId: "o-cortado", nombre: "Cortado", tipo: "VARIANTE", ordenDeGrupo: 1, ordenDeOpcion: 0, cantidad: 1, factorEscala: null, consumos: cortado.consumos ?? [] };
    const { pedidos } = ok(consumoDeLineaConfigurada({ cantidad: 1, sucursalId: SUCURSAL, base, opciones: [opcion], adicionales: [] }));
    expect(pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
      ["mp-grano", 10],
      ["mp-leche", 30],
      ["mp-vaso-chico", 1],
    ]);
  });

  it("las unidades de la opción multiplican el consumo (dos guarniciones iguales consumen el doble)", () => {
    const guarnicion: OpcionConConsumo = { opcionId: "o-papas", nombre: "Papas", tipo: "INCLUIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 2, factorEscala: null, consumos: [suma("mp-papas", 150, 10)] };
    const { pedidos } = ok(consumoDeLineaConfigurada({ cantidad: 3, sucursalId: SUCURSAL, base: [], opciones: [guarnicion], adicionales: [] }));
    expect(pedidos).toEqual([{ productoId: "mp-papas", cantidad: 990, insumoSustitutoIds: [], unidadStockId: "u-g" }]); // 150 × 2 × 3 × 1,10
  });
});

function reemplazo(reemplazaAProductoId: string, insumoProductoId: string, cantidad: number, escalaConLaMedida = false): ConsumoDeOpcionParaVender {
  return { efecto: "REEMPLAZA", insumoProductoId, reemplazaAProductoId, cantidad, unidadStockId: "u-g", mermaPorcentaje: 0, escalaConLaMedida };
}

function suma(insumoProductoId: string, cantidad: number, mermaPorcentaje = 0, escalaConLaMedida = false): ConsumoDeOpcionParaVender {
  return { efecto: "SUMA", insumoProductoId, reemplazaAProductoId: null, cantidad, unidadStockId: "u-g", mermaPorcentaje, escalaConLaMedida };
}

describe("consumoDeLineaConfigurada: hotel", () => {
  it("3 noches con desayuno, dos camas, cama extra y 2 desayunos extra: la línea de la noche y cada adicional con su propio consumo", () => {
    const r = ok(consumoDelEscenario(HOTEL, ["o-con-desayuno", "o-dos-camas", "o-cama-extra", ["o-desayuno-extra", 2]], 3));
    expect(r.pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
      ["mp-kit-de-limpieza", 3],
      ["mp-desayuno", 6],
      ["mp-juego-de-sabanas", 6],
    ]);
    expect(r.pedidosDeAdicionales.map((a) => [a.opcionId, a.cantidad, a.pedidos.map((p) => [p.productoId, p.cantidad])])).toEqual([
      ["o-cama-extra", 3, [["mp-juego-de-sabanas", 3], ["mp-toalla", 6]]],
      ["o-desayuno-extra", 6, [["mp-desayuno", 6]]],
    ]);
  });

  it("sin opciones que toquen la base (solo alojamiento, cama matrimonial) la base va idéntica a la de hoy", () => {
    const r = ok(consumoDelEscenario(HOTEL, ["o-solo-alojamiento", "o-matrimonial"], 2));
    expect(identicos(r.pedidos.slice(0, 1), pedidosDeHoy(HOTEL.base, 2))).toBe(true);
    expect(r.pedidos.slice(1)).toEqual([{ productoId: "mp-juego-de-sabanas", cantidad: 2, insumoSustitutoIds: [], unidadStockId: "u-u" }]);
  });
});

describe("consumoDeLineaConfigurada: spa", () => {
  it("masaje de 60 minutos (factor 1) con aroma: el aceite de la base va idéntico a hoy y la esencia se suma", () => {
    const r = ok(consumoDelEscenario(SPA, ["o-60", "o-eucalipto"]));
    expect(identicos(r.pedidos.slice(0, 1), pedidosDeHoy(SPA.base, 1))).toBe(true);
    expect(r.pedidos[1]).toEqual({ productoId: "mp-esencia-eucalipto", cantidad: 2, insumoSustitutoIds: [], unidadStockId: "u-ml" });
  });

  it("30 minutos: el aceite escala ×0,5 (15 ml) y la esencia no escala", () => {
    const { pedidos } = ok(consumoDelEscenario(SPA, ["o-30", "o-lavanda"]));
    expect(pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
      ["mp-aceite-estandar", 15],
      ["mp-esencia-lavanda", 2],
    ]);
  });

  it("90 minutos con aceite premium: el premium reemplaza al estándar y escala ×1,5 (45 ml); ya no se consume el estándar", () => {
    const { pedidos } = ok(consumoDelEscenario(SPA, ["o-90", "o-aceite-premium", "o-lavanda"]));
    expect(pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
      ["mp-aceite-premium", 45],
      ["mp-esencia-lavanda", 2],
    ]);
  });

  it("piedras calientes: línea aparte con su gel (1 por masaje)", () => {
    const r = ok(consumoDelEscenario(SPA, ["o-60", "o-lavanda", "o-piedras"], 2));
    expect(r.pedidosDeAdicionales).toEqual([{ opcionId: "o-piedras", cantidad: 2, pedidos: [{ productoId: "mp-gel-caliente", cantidad: 2, insumoSustitutoIds: [], unidadStockId: "u-u" }] }]);
  });
});

describe("consumoDeLineaConfigurada: factor de la MEDIDA y rendimiento de la sucursal", () => {
  const medida = (factorEscala: number | null): OpcionConConsumo => ({ opcionId: "m", nombre: "Medida", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala, consumos: [] });
  const entrada = (opciones: OpcionConConsumo[], base: IngredienteDeBase[] = CAFE.base): EntradaDeConsumoConfigurado => ({ cantidad: 1, sucursalId: SUCURSAL, base, opciones, adicionales: [] });

  it("una medida sin factor (null) o con factor 1 deja la base idéntica a la de hoy", () => {
    expect(identicos(ok(consumoDeLineaConfigurada(entrada([medida(null)]))).pedidos, pedidosDeHoy(CAFE.base, 1))).toBe(true);
    expect(identicos(ok(consumoDeLineaConfigurada(entrada([medida(1)]))).pedidos, pedidosDeHoy(CAFE.base, 1))).toBe(true);
    expect(identicos(ok(consumoDeLineaConfigurada(entrada([]))).pedidos, pedidosDeHoy(CAFE.base, 1))).toBe(true);
  });

  it("con un factor distinto de 1 la cuenta es exacta en decimal y respeta la calibración de la sucursal (rendimiento y merma locales)", () => {
    const calibrado: IngredienteDeBase = {
      unidadStockId: "u-g",
      ingrediente: {
        insumoProductoId: "mp-x",
        cantidad: 10,
        mermaPorcentaje: 3,
        insumoSustitutoIds: ["mp-y"],
        rendimientosLocales: [
          { sucursalId: SUCURSAL, cantidad: 12, mermaPorcentaje: null },
          { sucursalId: "otra-sucursal", cantidad: 99, mermaPorcentaje: 50 },
        ],
      },
    };
    const { pedidos } = ok(consumoDeLineaConfigurada({ cantidad: 3, sucursalId: SUCURSAL, base: [calibrado], opciones: [medida(0.3333)], adicionales: [] }));
    // 3 × 0,3333 × 12 × 1,03 = 12,357... exacto: 12.3586... (decimal), no la deriva de multiplicar en float
    expect(pedidos).toEqual([{ productoId: "mp-x", cantidad: new Dec(3).times("0.3333").times(12).times("1.03").toNumber(), insumoSustitutoIds: ["mp-y"], unidadStockId: "u-g" }]);
  });

  it("una receta vacía (el producto ancla de un adicional) no consume nada de la base", () => {
    expect(ok(consumoDeLineaConfigurada({ cantidad: 5, sucursalId: SUCURSAL, base: [], opciones: [], adicionales: [] })).pedidos).toEqual([]);
  });
});

describe("consumoDeLineaConfigurada: precisión de la cuenta", () => {
  it("el producto de tres números de 17 dígitos no pierde precisión (con 20 dígitos daría 0,12794730955360598)", () => {
    const adicional: AdicionalConConsumo = { opcionId: "a", nombre: "A", cantidadPorUnidad: 1, consumos: [suma("mp-extra", 127.9473095536059)] };
    const r = ok(consumoDeLineaConfigurada({ cantidad: 0.0010000000000000007, sucursalId: SUCURSAL, base: [], opciones: [], adicionales: [adicional] }));
    expect(r.pedidosDeAdicionales[0].pedidos[0].cantidad).toBe(0.127947309553606);
  });
});

describe("consumoDeLineaConfigurada: rechazos", () => {
  const base = { sucursalId: SUCURSAL, base: CAFE.base, opciones: [] as OpcionConConsumo[], adicionales: [] as AdicionalConConsumo[] };
  const opcion = (extra: Partial<OpcionConConsumo> = {}): OpcionConConsumo => ({ opcionId: "o", nombre: "Opción", tipo: "VARIANTE", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: null, consumos: [], ...extra });
  const adicional = (extra: Partial<AdicionalConConsumo> = {}): AdicionalConConsumo => ({ opcionId: "a", nombre: "Extra", cantidadPorUnidad: 1, consumos: [suma("mp-grano", 9)], ...extra });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("la cantidad vendida %s no es válida → CANTIDAD_INVALIDA", (cantidad) => {
    expect(falla(consumoDeLineaConfigurada({ ...base, cantidad })).codigo).toBe("CANTIDAD_INVALIDA");
  });

  it("la cantidad de una opción o de un adicional es un entero de 1 a 10", () => {
    for (const cantidad of [0, 11, 1.5, -1]) {
      expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ cantidad })] })).codigo, `opción ${cantidad}`).toBe("CANTIDAD_INVALIDA");
      expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, adicionales: [adicional({ cantidadPorUnidad: cantidad })] })).codigo, `adicional ${cantidad}`).toBe("CANTIDAD_INVALIDA");
    }
    expect(ok(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ cantidad: 10 })] })).pedidos).toHaveLength(3);
    expect(ok(consumoDeLineaConfigurada({ ...base, cantidad: 1, adicionales: [adicional({ cantidadPorUnidad: 10 })] })).pedidosDeAdicionales[0].cantidad).toBe(10);
  });

  it("dos medidas en una línea → OPCIONES_INCOMPATIBLES", () => {
    const r = falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ opcionId: "m1", nombre: "Chico", tipo: "MEDIDA", factorEscala: 1 }), opcion({ opcionId: "m2", nombre: "Grande", tipo: "MEDIDA", factorEscala: 2 })] }));
    expect(r).toMatchObject({ codigo: "OPCIONES_INCOMPATIBLES", opcionId: "m2", mensaje: "«Chico» y «Grande» no se pueden elegir juntas: una línea lleva una sola medida." });
  });

  it("el factor de escala es solo de la MEDIDA, mayor que 0 y hasta 10", () => {
    expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ factorEscala: 2 })] })).codigo).toBe("FACTOR_DE_ESCALA_INVALIDO");
    for (const f of [0, -1, 10.5, Number.NaN]) {
      expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ tipo: "MEDIDA", factorEscala: f })] })).codigo, String(f)).toBe("FACTOR_DE_ESCALA_INVALIDO");
    }
    expect(ok(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ tipo: "MEDIDA", factorEscala: 10 })] })).pedidos[0].cantidad).toBe(100);
  });

  it("un consumo mal definido se rechaza: un reemplazo sin su insumo, una suma con insumo a reemplazar, cantidad o merma fuera de rango", () => {
    const malos: ConsumoDeOpcionParaVender[] = [
      { ...reemplazo("mp-leche", "mp-a", 1), reemplazaAProductoId: null },
      { ...suma("mp-a", 1), reemplazaAProductoId: "mp-leche" },
      suma("mp-a", 0),
      suma("mp-a", -1),
      suma("mp-a", Number.NaN),
      suma("mp-a", 1, -1),
      suma("mp-a", 1, 100.5),
      suma("mp-a", 1, Number.NaN),
    ];
    for (const consumo of malos) {
      const r = falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ consumos: [consumo] })] }));
      expect(r.codigo, JSON.stringify(consumo)).toBe("CONSUMO_INVALIDO");
      expect(r.opcionId).toBe("o");
    }
    expect(ok(consumoDeLineaConfigurada({ ...base, cantidad: 1, opciones: [opcion({ consumos: [suma("mp-a", 1, 0), suma("mp-b", 1, 100)] })] })).pedidos).toHaveLength(5);
  });

  it("un adicional solo suma y no escala con la medida", () => {
    expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, adicionales: [adicional({ consumos: [reemplazo("mp-leche", "mp-a", 1)] })] })).codigo).toBe("CONSUMO_INVALIDO");
    const r = falla(consumoDeLineaConfigurada({ ...base, cantidad: 1, adicionales: [adicional({ consumos: [suma("mp-a", 1, 0, true)] })] }));
    expect(r).toMatchObject({ codigo: "CONSUMO_INVALIDO", opcionId: "a", mensaje: "«Extra» es un adicional: solo puede sumar insumos y no escala con la medida." });
  });

  it("los códigos son una lista cerrada y los mensajes no hablan de un solo rubro", () => {
    expect(new Set(CODIGOS_DE_ERROR_DE_CONSUMO).size).toBe(CODIGOS_DE_ERROR_DE_CONSUMO.length);
    expect(falla(consumoDeLineaConfigurada({ ...base, cantidad: 0 })).mensaje).not.toMatch(/plato|receta|cocina|comanda/i);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ */
/* Propiedades                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

const RUNS = { numRuns: 1000 };
const numeroArb = fc.double({ min: 0.001, max: 1000, noNaN: true, noDefaultInfinity: true });
const mermaArb = fc.double({ min: 0, max: 99, noNaN: true, noDefaultInfinity: true });
const SUCURSALES = ["suc-a", "suc-b"] as const;

const ingredienteArb: fc.Arbitrary<IngredienteDeBase> = fc.record({
  unidadStockId: fc.constantFrom("u-g", "u-ml", "u-u"),
  ingrediente: fc.record({
    insumoProductoId: fc.constantFrom("mp-1", "mp-2", "mp-3"),
    cantidad: numeroArb,
    mermaPorcentaje: mermaArb,
    insumoSustitutoIds: fc.array(fc.constantFrom("ins-1", "ins-2"), { maxLength: 2 }),
    rendimientosLocales: fc.array(
      fc.record({ sucursalId: fc.constantFrom(...SUCURSALES), cantidad: fc.option(numeroArb, { nil: null }), mermaPorcentaje: fc.option(mermaArb, { nil: null }) }),
      { maxLength: 3 }
    ),
  }),
});
const baseArb = fc.uniqueArray(ingredienteArb, { maxLength: 4, selector: (b) => b.ingrediente.insumoProductoId });

describe("consumoDeLineaConfigurada (propiedades)", () => {
  it("con factor 1 (o sin medida) y sin opciones que toquen la base, los pedidos son Object.is-idénticos a los de pedidoDeIngrediente", () => {
    fc.assert(
      fc.property(baseArb, numeroArb, fc.constantFrom(...SUCURSALES), fc.constantFrom(null, 1), (base, cantidad, sucursalId, factor) => {
        const medidas: OpcionConConsumo[] = factor === null ? [] : [{ opcionId: "m", nombre: "M", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: factor, consumos: [] }];
        const r = ok(consumoDeLineaConfigurada({ cantidad, sucursalId, base, opciones: medidas, adicionales: [] }));
        const hoy = pedidosDeHoy(base, cantidad, sucursalId);
        expect(identicos(r.pedidos, hoy)).toBe(true);
        expect(r.pedidos).toEqual(hoy);
      }),
      RUNS
    );
  });

  it("con un factor f distinto de 1, cada ingrediente de la base es cantidad × f × rendimiento efectivo × (1 + merma/100) en decimal exacto", () => {
    fc.assert(
      fc.property(baseArb, numeroArb, fc.constantFrom(...SUCURSALES), fc.integer({ min: 1, max: 100_000 }).filter((m) => m !== 10_000), (base, cantidad, sucursalId, m) => {
        const factor = m / 10_000;
        const medida: OpcionConConsumo = { opcionId: "m", nombre: "M", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: factor, consumos: [] };
        const { pedidos } = ok(consumoDeLineaConfigurada({ cantidad, sucursalId, base, opciones: [medida], adicionales: [] }));
        expect(pedidos).toHaveLength(base.length);
        base.forEach((b, i) => {
          const ef = rendimientoEfectivo({ cantidad: b.ingrediente.cantidad, mermaPorcentaje: b.ingrediente.mermaPorcentaje }, b.ingrediente.rendimientosLocales, sucursalId);
          const esperado = new Dec(cantidad).times(factor).times(ef.cantidad).times(new Dec(1).plus(new Dec(ef.mermaPorcentaje).dividedBy(100))).toNumber();
          expect(pedidos[i]).toEqual({ productoId: b.ingrediente.insumoProductoId, cantidad: esperado, insumoSustitutoIds: b.ingrediente.insumoSustitutoIds, unidadStockId: b.unidadStockId });
        });
      }),
      RUNS
    );
  });

  it("las líneas que SUMAN y REEMPLAZAN son cantidad vendida × unidades × cantidad del consumo × (escala solo si la pide) × (1 + merma/100), exacto", () => {
    const consumoArb = fc.record({ cantidad: numeroArb, merma: mermaArb, escala: fc.boolean() });
    fc.assert(
      fc.property(numeroArb, fc.integer({ min: 1, max: 10 }), fc.integer({ min: 5_000, max: 30_000 }), consumoArb, consumoArb, (vendida, unidades, m, s, r) => {
        const factor = m / 10_000;
        const base: IngredienteDeBase[] = [{ unidadStockId: "u-g", ingrediente: { insumoProductoId: "mp-base", cantidad: 5, mermaPorcentaje: 0, insumoSustitutoIds: [], rendimientosLocales: [] } }];
        const medida: OpcionConConsumo = { opcionId: "m", nombre: "M", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: factor, consumos: [] };
        const variante: OpcionConConsumo = {
          opcionId: "v",
          nombre: "V",
          tipo: "VARIANTE",
          ordenDeGrupo: 1,
          ordenDeOpcion: 0,
          cantidad: unidades,
          factorEscala: null,
          consumos: [reemplazo("mp-base", "mp-nuevo", r.cantidad, r.escala), suma("mp-extra", s.cantidad, s.merma, s.escala)].map((c, i) => ({ ...c, mermaPorcentaje: i === 0 ? r.merma : s.merma })),
        };
        const res = ok(consumoDeLineaConfigurada({ cantidad: vendida, sucursalId: "suc-a", base, opciones: [variante, medida], adicionales: [] }));
        const esperado = (c: { cantidad: number; merma: number; escala: boolean }) =>
          new Dec(vendida).times(unidades).times(c.cantidad).times(c.escala ? factor : 1).times(new Dec(1).plus(new Dec(c.merma).dividedBy(100))).toNumber();
        expect(res.pedidos.map((p) => [p.productoId, p.cantidad])).toEqual([
          ["mp-nuevo", esperado(r)],
          ["mp-extra", esperado(s)],
        ]);
      }),
      RUNS
    );
  });

  it("el consumo de un adicional es k × cantidad vendida × cantidad del consumo × (1 + merma/100) y no depende de la medida", () => {
    fc.assert(
      fc.property(numeroArb, fc.integer({ min: 1, max: 10 }), numeroArb, mermaArb, fc.integer({ min: 100, max: 50_000 }), (vendida, k, cantidadConsumo, merma, m) => {
        const adicionalElegido: AdicionalConConsumo = { opcionId: "a", nombre: "A", cantidadPorUnidad: k, consumos: [suma("mp-extra", cantidadConsumo, merma)] };
        const medida: OpcionConConsumo = { opcionId: "m", nombre: "M", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala: m / 10_000, consumos: [] };
        const sinMedida = ok(consumoDeLineaConfigurada({ cantidad: vendida, sucursalId: "suc-a", base: [], opciones: [], adicionales: [adicionalElegido] }));
        const conMedida = ok(consumoDeLineaConfigurada({ cantidad: vendida, sucursalId: "suc-a", base: [], opciones: [medida], adicionales: [adicionalElegido] }));
        const lineaDelAdicional = new Dec(vendida).times(k);
        const esperado = lineaDelAdicional.times(cantidadConsumo).times(new Dec(1).plus(new Dec(merma).dividedBy(100))).toNumber();
        expect(sinMedida.pedidosDeAdicionales).toEqual([{ opcionId: "a", cantidad: lineaDelAdicional.toNumber(), pedidos: [{ productoId: "mp-extra", cantidad: esperado, insumoSustitutoIds: [], unidadStockId: "u-g" }] }]);
        expect(conMedida.pedidosDeAdicionales).toEqual(sinMedida.pedidosDeAdicionales);
      }),
      RUNS
    );
  });

  it("el orden en que llegan las opciones no cambia el resultado", () => {
    const todas = CAFE.opciones.filter((o) => ["o-mediano", "o-con-leche", "o-shot"].includes(o.opcionId));
    const validadas = validarOpcionesElegidas(permitidosDe(CAFE), todas.map((o) => ({ opcionId: o.opcionId, cantidad: 1 })));
    if (!validadas.ok) throw new Error(validadas.mensaje);
    const { opciones, adicionales } = paraConsumo(CAFE, validadas.opciones);
    const referencia = consumoDeLineaConfigurada({ cantidad: 2, sucursalId: SUCURSAL, base: CAFE.base, opciones, adicionales });
    fc.assert(
      fc.property(fc.shuffledSubarray(opciones, { minLength: opciones.length, maxLength: opciones.length }), (barajadas) => {
        expect(consumoDeLineaConfigurada({ cantidad: 2, sucursalId: SUCURSAL, base: CAFE.base, opciones: barajadas, adicionales })).toEqual(referencia);
      }),
      { numRuns: 100 }
    );
  });
});
