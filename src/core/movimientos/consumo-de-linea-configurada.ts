import { Decimal } from "decimal.js";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { CANTIDAD_MAXIMA_DE_OPCION, FACTOR_DE_ESCALA_MAXIMO, type EfectoDeConsumoDeOpcion } from "@/core/opciones/public";
import { pedidoDeIngrediente, type IngredienteParaVender } from "./linea-de-venta";

/**
 * El CONSUMO de una línea configurada (GO-0b; diseño §2.13 con la decisión 1 del dueño, invariantes I6 e I7): transforma la receta efectiva del producto base (más lo
 * que las opciones escalan, reemplazan y suman) en los MISMOS `pedidos` que hoy arma `armarLinea` (`registrar-venta-en-tx.ts`) y que consume `asignarOrigenDeLaVenta`:
 * `{ productoId, cantidad, insumoSustitutoIds, unidadStockId }`. Función pura: sin base, sin reloj, sin azar. HOY nadie de producción la llama (solo los tests); el
 * camino de venta de siempre sigue como está.
 *
 * Reglas, en este orden:
 * 1. FACTOR f: el `factorEscala` de la MEDIDA elegida (sin MEDIDA, o con factor `null`, f = 1). Cada ingrediente de la base que NO se reemplaza consume cantidad × f.
 *    Con f = 1 se usa `pedidoDeIngrediente`, la fórmula de siempre, sin una operación de más: el resultado es IDÉNTICO (`Object.is`) al de hoy, con o sin opciones que
 *    no toquen la base. Con f distinto de 1, la cuenta es en decimal exacto (decimal.js) y se entrega como `number`, con el mismo rendimiento y la misma merma de la sucursal.
 * 2. REEMPLAZA: primero la MEDIDA y después el resto en el orden de los grupos (`ordenDeGrupo`, `ordenDeOpcion`, `opcionId`: el resultado no depende del orden de entrada).
 *    El insumo X de la base pasa a ser el insumo Y con la cantidad ABSOLUTA de la opción (× f solo si `escalaConLaMedida`; por defecto no: «el vaso no se multiplica»),
 *    en el mismo lugar de la lista. Dos opciones que reemplazan el mismo X, o dos MEDIDAS, son incompatibles: `OPCIONES_INCOMPATIBLES`. Si X no está en la base, ese
 *    reemplazo NO aplica (ni quita ni agrega nada) y queda en `reemplazosSinEfecto` para avisarlo. Si la base trae el mismo insumo X en dos líneas, Y va una sola vez,
 *    en el lugar de la primera.
 * 3. SUMA: se agregan al final, en el mismo orden (× f solo si `escalaConLaMedida`; por defecto no).
 * 4. Todo × la cantidad vendida y × las unidades de la opción, y × (1 + merma/100) en las líneas de las opciones, multiplicado con decimal.js.
 * 5. ADICIONALES: cada uno es OTRA línea de venta (respaldada por un producto «ancla» SIN receta). Su consumo sale de su propio `ConsumoDeOpcion`, solo SUMA, × la cantidad
 *    del adicional (k × la cantidad vendida del padre); no lo escala la medida. Se devuelve aparte, un juego de `pedidos` por adicional.
 *
 * Las líneas reemplazadas o sumadas van con `insumoSustitutoIds: []` (v1); las de la base conservan los sustitutos de su línea de receta.
 *
 * GO-3 (ADR-032, frente B), rama ADITIVA `excepcion`: la RECETA PROPIA de la combinación vendida (la versión congelada al agregar el ítem, `CombinacionEnLinea.recetaDeCombinacionVersionId`).
 * Sin `excepcion` (o con una excepción SIN ingredientes, que significa «vuelve a la regla general») el resultado es exactamente el de arriba: mismas operaciones, mismos números (`Object.is`).
 * Con una excepción no vacía:
 * a. la BASE es la excepción y no la receta del producto. Si la MEDIDA elegida es uno de los ejes de la combinación, la base NO se escala (f = 1 sobre la base: ya es la receta de ese
 *    tamaño); si la MEDIDA no es eje (los ejes son dos variantes), la excepción se escala por la medida como cualquier base. La cuenta de la excepción es siempre en decimal exacto;
 * b. se saltean los consumos de las VARIANTE que son eje y los de la MEDIDA eje que ESCALAN (`escalaConLaMedida`): la excepción ya los cubre;
 * c. se mantienen los de la MEDIDA eje que NO escalan (el envase: el vaso de 400 ml), enteros, SUMA o REEMPLAZA, aplicados sobre la excepción;
 * d. las opciones que NO son eje (otra VARIANTE, una INCLUIDA) se aplican como siempre sobre la excepción: su REEMPLAZA usa la cantidad absoluta de la opción × el factor de la medida
 *    si escala, igual que sin excepción; un REEMPLAZA cuyo insumo no está en la excepción queda en `reemplazosSinEfecto`;
 * e. los ADICIONALES no cambian.
 * Supuestos de v1: la excepción es de la empresa (sin calibración de rendimiento por sucursal) y sin sustitutos: por eso sus ingredientes no traen ni una cosa ni la otra.
 */

/**
 * Un pedido de consumo: la misma forma que `LineaArmada["pedidos"][number]` (`plan-de-la-venta.ts`), escrita acá para no importar ese archivo (GO-2b: los tipos de la
 * venta, en `registrar-venta.ts`, nombran los de este; importar el plan cerraba un ciclo de tipos).
 */
type Pedido = { productoId: string; cantidad: number; insumoSustitutoIds: string[]; unidadStockId: string };

/** El clon propio de decimal.js, igual que `core/moneda.ts`: 40 dígitos y empates hacia arriba, sin depender de la configuración global. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Una línea de la receta efectiva de la base, con la unidad de stock de su materia prima (como hoy: `pedidoDeIngrediente(cantidad, ing, mp.unidadStockId, sucursalId)`). */
export interface IngredienteDeBase {
  ingrediente: IngredienteParaVender;
  unidadStockId: string;
}

/** Una fila de `ConsumoDeOpcion`, ya en números planos. `cantidad` es por unidad vendida. */
export interface ConsumoDeOpcionParaVender {
  efecto: EfectoDeConsumoDeOpcion;
  insumoProductoId: string;
  /** El insumo de la base que reemplaza: obligatorio con REEMPLAZA, ausente (`null`) con SUMA. */
  reemplazaAProductoId: string | null;
  cantidad: number;
  unidadStockId: string;
  mermaPorcentaje: number;
  escalaConLaMedida: boolean;
}

/** Una opción elegida DENTRO del precio (MEDIDA, VARIANTE o INCLUIDA) con su consumo. */
export interface OpcionConConsumo {
  opcionId: string;
  nombre: string;
  tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA";
  ordenDeGrupo: number;
  ordenDeOpcion: number;
  /** Unidades de la opción por unidad vendida (1 a 10). */
  cantidad: number;
  /** Solo MEDIDA; `null` = sin escala (f = 1). */
  factorEscala: number | null;
  consumos: readonly ConsumoDeOpcionParaVender[];
}

/** Un adicional elegido, con su consumo (solo SUMA). */
export interface AdicionalConConsumo {
  opcionId: string;
  nombre: string;
  /** La `k`: unidades por unidad vendida del producto. */
  cantidadPorUnidad: number;
  consumos: readonly ConsumoDeOpcionParaVender[];
}

/** GO-3: un ingrediente de la receta propia de una combinación (`RecetaDeCombinacionIngrediente`), ya en números planos. Sin calibración local ni sustitutos (v1). */
export interface IngredienteDeExcepcion {
  insumoProductoId: string;
  /** Por unidad vendida, en la unidad de stock del insumo. */
  cantidad: number;
  mermaPorcentaje: number;
  unidadStockId: string;
}

/** GO-3: la receta propia de la combinación vendida y qué opciones elegidas son los ejes de esa combinación. */
export interface ExcepcionDeCombinacion {
  ingredientes: readonly IngredienteDeExcepcion[];
  /** Los `opcionId` de las opciones elegidas que son eje (1 o 2): tienen que estar entre `opciones` y ser MEDIDA o VARIANTE. */
  opcionesDeEjes: readonly string[];
}

export interface EntradaDeConsumoConfigurado {
  /** Cantidad vendida del producto base (mayor que 0). */
  cantidad: number;
  sucursalId: string;
  /** La receta efectiva de la base, en el orden del libro (id ascendente). Vacía si el producto no tiene receta. */
  base: readonly IngredienteDeBase[];
  opciones: readonly OpcionConConsumo[];
  adicionales: readonly AdicionalConConsumo[];
  /** GO-3: la receta propia de la combinación vendida, si la tiene (ausente = la regla general, como siempre). */
  excepcion?: ExcepcionDeCombinacion;
}

export interface ReemplazoSinEfecto {
  opcionId: string;
  /** El insumo que la opción quería reemplazar y no está en la base. */
  reemplazaAProductoId: string;
}

export const CODIGOS_DE_ERROR_DE_CONSUMO = ["CANTIDAD_INVALIDA", "FACTOR_DE_ESCALA_INVALIDO", "CONSUMO_INVALIDO", "OPCIONES_INCOMPATIBLES"] as const;
export type CodigoDeErrorDeConsumo = (typeof CODIGOS_DE_ERROR_DE_CONSUMO)[number];

export type ResultadoDeConsumoConfigurado =
  | {
      ok: true;
      /** El consumo de la línea del producto: lo mismo que `armarLinea` pone en `pedidos`. */
      pedidos: Pedido[];
      /** El consumo de la línea de cada adicional, en el orden recibido. `cantidad` es la de la línea del adicional (k × la vendida). */
      pedidosDeAdicionales: { opcionId: string; cantidad: number; pedidos: Pedido[] }[];
      reemplazosSinEfecto: ReemplazoSinEfecto[];
    }
  | { ok: false; codigo: CodigoDeErrorDeConsumo; mensaje: string; opcionId?: string };

type Falla = Extract<ResultadoDeConsumoConfigurado, { ok: false }>;

function falla(codigo: CodigoDeErrorDeConsumo, mensaje: string, opcionId?: string): Falla {
  return { ok: false, codigo, mensaje, ...(opcionId === undefined ? {} : { opcionId }) };
}

function validarConsumos(consumos: readonly ConsumoDeOpcionParaVender[], nombre: string, opcionId: string, esAdicional: boolean): Falla | null {
  for (const c of consumos) {
    if ((c.efecto === "REEMPLAZA") !== (c.reemplazaAProductoId !== null)) {
      return falla("CONSUMO_INVALIDO", `El consumo de «${nombre}» está mal definido: un reemplazo necesita el insumo que reemplaza y una suma no lo lleva.`, opcionId);
    }
    if (!Number.isFinite(c.cantidad) || c.cantidad <= 0) return falla("CONSUMO_INVALIDO", `El consumo de «${nombre}» tiene que ser una cantidad mayor que 0.`, opcionId);
    if (!Number.isFinite(c.mermaPorcentaje) || c.mermaPorcentaje < 0 || c.mermaPorcentaje > 100) {
      return falla("CONSUMO_INVALIDO", `La merma del consumo de «${nombre}» tiene que estar entre 0 y 100.`, opcionId);
    }
    if (esAdicional && (c.efecto !== "SUMA" || c.escalaConLaMedida)) {
      return falla("CONSUMO_INVALIDO", `«${nombre}» es un adicional: solo puede sumar insumos y no escala con la medida.`, opcionId);
    }
  }
  return null;
}

/** Unidades vendidas × unidades de la opción × cantidad del consumo × (1 + merma/100), en decimal exacto y entregado como `number`. */
function pedidoDeConsumo(c: ConsumoDeOpcionParaVender, unidades: Decimal.Value, factor: Decimal.Value): Pedido {
  const cantidad = new D(unidades).times(c.cantidad).times(factor).times(new D(1).plus(new D(c.mermaPorcentaje).dividedBy(100)));
  return { productoId: c.insumoProductoId, cantidad: cantidad.toNumber(), insumoSustitutoIds: [], unidadStockId: c.unidadStockId };
}

/** Un ingrediente de la base escalado por f distinto de 1: la misma fórmula de `pedidoDeIngrediente` (rendimiento y merma de la sucursal), en decimal exacto. */
function pedidoDeBaseEscalado(cantidad: number, factor: number, base: IngredienteDeBase, sucursalId: string): Pedido {
  const ing = base.ingrediente;
  const ef = rendimientoEfectivo({ cantidad: ing.cantidad, mermaPorcentaje: ing.mermaPorcentaje }, ing.rendimientosLocales, sucursalId);
  const consumo = new D(cantidad).times(factor).times(ef.cantidad).times(new D(1).plus(new D(ef.mermaPorcentaje).dividedBy(100)));
  return { productoId: ing.insumoProductoId, cantidad: consumo.toNumber(), insumoSustitutoIds: ing.insumoSustitutoIds, unidadStockId: base.unidadStockId };
}

/**
 * GO-3: la base y las opciones con la excepción aplicada (reglas a, b y c), o `null` si no hay excepción (o está vacía): en ese caso quien llama sigue con la entrada tal cual.
 * Valida la excepción (cantidades y mermas, y que los ejes sean opciones elegidas de tipo MEDIDA o VARIANTE).
 */
function aplicarExcepcion(entrada: EntradaDeConsumoConfigurado): { base: IngredienteDeBase[]; opciones: OpcionConConsumo[]; medidaEsEje: boolean } | Falla | null {
  const excepcion = entrada.excepcion;
  if (excepcion === undefined || excepcion.ingredientes.length === 0) return null;
  for (const i of excepcion.ingredientes) {
    if (!Number.isFinite(i.cantidad) || i.cantidad <= 0 || !Number.isFinite(i.mermaPorcentaje) || i.mermaPorcentaje < 0 || i.mermaPorcentaje > 100) {
      return falla("CONSUMO_INVALIDO", "La receta propia de la combinación tiene un ingrediente con una cantidad o una merma inválida.");
    }
  }
  const ejes = new Set(excepcion.opcionesDeEjes);
  for (const id of ejes) {
    const opcion = entrada.opciones.find((o) => o.opcionId === id);
    if (!opcion || opcion.tipo === "INCLUIDA") return falla("CONSUMO_INVALIDO", "La receta propia de la combinación no corresponde a las opciones elegidas.", id);
  }
  const base = excepcion.ingredientes.map(
    (i): IngredienteDeBase => ({
      ingrediente: { insumoProductoId: i.insumoProductoId, cantidad: i.cantidad, mermaPorcentaje: i.mermaPorcentaje, rendimientosLocales: [], insumoSustitutoIds: [] },
      unidadStockId: i.unidadStockId,
    }),
  );
  const opciones = entrada.opciones.map((o): OpcionConConsumo => {
    if (!ejes.has(o.opcionId)) return o;
    if (o.tipo === "VARIANTE") return { ...o, consumos: [] };
    return { ...o, consumos: o.consumos.filter((c) => !c.escalaConLaMedida) };
  });
  const medidaEsEje = entrada.opciones.some((o) => o.tipo === "MEDIDA" && ejes.has(o.opcionId));
  return { base, opciones, medidaEsEje };
}

export function consumoDeLineaConfigurada(entrada: EntradaDeConsumoConfigurado): ResultadoDeConsumoConfigurado {
  const { cantidad, sucursalId, adicionales } = entrada;
  if (!Number.isFinite(cantidad) || cantidad <= 0) return falla("CANTIDAD_INVALIDA", "La cantidad vendida tiene que ser un número mayor que 0.");

  // GO-3: con una receta propia de la combinación, la base y los consumos de los ejes cambian (`aplicarExcepcion`); sin ella, todo sigue exactamente igual.
  const conExcepcion = aplicarExcepcion(entrada);
  if (conExcepcion !== null && "ok" in conExcepcion) return conExcepcion;
  const base = conExcepcion === null ? entrada.base : conExcepcion.base;

  // Primero la MEDIDA y después el resto, cada uno en el orden de los grupos: el resultado no depende del orden en que llegaron.
  const opciones = [...(conExcepcion === null ? entrada.opciones : conExcepcion.opciones)].sort(
    (a, b) =>
      Number(b.tipo === "MEDIDA") - Number(a.tipo === "MEDIDA") ||
      a.ordenDeGrupo - b.ordenDeGrupo ||
      a.ordenDeOpcion - b.ordenDeOpcion ||
      (a.opcionId < b.opcionId ? -1 : a.opcionId > b.opcionId ? 1 : 0)
  );

  const medidas = opciones.filter((o) => o.tipo === "MEDIDA");
  if (medidas.length > 1) return falla("OPCIONES_INCOMPATIBLES", `«${medidas[0].nombre}» y «${medidas[1].nombre}» no se pueden elegir juntas: una línea lleva una sola medida.`, medidas[1].opcionId);

  for (const o of opciones) {
    if (!Number.isInteger(o.cantidad) || o.cantidad < 1 || o.cantidad > CANTIDAD_MAXIMA_DE_OPCION) {
      return falla("CANTIDAD_INVALIDA", `La cantidad de «${o.nombre}» tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`, o.opcionId);
    }
    if (o.factorEscala !== null && (o.tipo !== "MEDIDA" || !Number.isFinite(o.factorEscala) || o.factorEscala <= 0 || o.factorEscala > FACTOR_DE_ESCALA_MAXIMO)) {
      return falla("FACTOR_DE_ESCALA_INVALIDO", `El factor de escala de «${o.nombre}» no es válido: solo un tamaño lo tiene, mayor que 0 y hasta ${FACTOR_DE_ESCALA_MAXIMO}.`, o.opcionId);
    }
    const mal = validarConsumos(o.consumos, o.nombre, o.opcionId, false);
    if (mal) return mal;
  }
  for (const a of adicionales) {
    if (!Number.isInteger(a.cantidadPorUnidad) || a.cantidadPorUnidad < 1 || a.cantidadPorUnidad > CANTIDAD_MAXIMA_DE_OPCION) {
      return falla("CANTIDAD_INVALIDA", `La cantidad de «${a.nombre}» tiene que ser un número entero entre 1 y ${CANTIDAD_MAXIMA_DE_OPCION}.`, a.opcionId);
    }
    const mal = validarConsumos(a.consumos, a.nombre, a.opcionId, true);
    if (mal) return mal;
  }

  const factor = medidas.length === 1 && medidas[0].factorEscala !== null ? medidas[0].factorEscala : 1;
  // GO-3 (regla a): la excepción de una combinación cuyo eje es la MEDIDA ya es la receta de ese tamaño: no se escala. Sin excepción, es el factor de siempre.
  const factorDeLaBase = conExcepcion !== null && conExcepcion.medidaEsEje ? 1 : factor;

  // Un solo reemplazo por insumo de la base, en el orden en que se aplican.
  const reemplazos = new Map<string, { opcion: OpcionConConsumo; consumo: ConsumoDeOpcionParaVender }>();
  for (const opcion of opciones) {
    for (const consumo of opcion.consumos) {
      if (consumo.reemplazaAProductoId === null) continue; // una suma (ya validado: REEMPLAZA si y solo si lleva el insumo que reemplaza)
      const previo = reemplazos.get(consumo.reemplazaAProductoId);
      if (previo) {
        return falla("OPCIONES_INCOMPATIBLES", `«${previo.opcion.nombre}» y «${opcion.nombre}» no se pueden elegir juntas: las dos cambian el mismo insumo.`, opcion.opcionId);
      }
      reemplazos.set(consumo.reemplazaAProductoId, { opcion, consumo });
    }
  }

  const pedidos: Pedido[] = [];
  const aplicados = new Set<string>();
  for (const b of base) {
    const reemplazo = reemplazos.get(b.ingrediente.insumoProductoId);
    if (!reemplazo) {
      // Sin excepción: la fórmula de siempre con f = 1 (idéntica bit a bit) o la escalada. Con excepción (código nuevo), siempre en decimal exacto.
      pedidos.push(conExcepcion === null && factorDeLaBase === 1 ? pedidoDeIngrediente(cantidad, b.ingrediente, b.unidadStockId, sucursalId) : pedidoDeBaseEscalado(cantidad, factorDeLaBase, b, sucursalId));
      continue;
    }
    if (aplicados.has(b.ingrediente.insumoProductoId)) continue;
    aplicados.add(b.ingrediente.insumoProductoId);
    pedidos.push(pedidoDeConsumo(reemplazo.consumo, new D(cantidad).times(reemplazo.opcion.cantidad), reemplazo.consumo.escalaConLaMedida ? factor : 1));
  }

  const reemplazosSinEfecto: ReemplazoSinEfecto[] = [];
  for (const [insumo, { opcion }] of reemplazos) {
    if (!aplicados.has(insumo)) reemplazosSinEfecto.push({ opcionId: opcion.opcionId, reemplazaAProductoId: insumo });
  }

  for (const opcion of opciones) {
    for (const consumo of opcion.consumos) {
      if (consumo.efecto !== "SUMA") continue;
      pedidos.push(pedidoDeConsumo(consumo, new D(cantidad).times(opcion.cantidad), consumo.escalaConLaMedida ? factor : 1));
    }
  }

  const pedidosDeAdicionales = adicionales.map((a) => {
    const cantidadDeLaLinea = new D(cantidad).times(a.cantidadPorUnidad);
    return { opcionId: a.opcionId, cantidad: cantidadDeLaLinea.toNumber(), pedidos: a.consumos.map((c) => pedidoDeConsumo(c, cantidadDeLaLinea, 1)) };
  });

  return { ok: true, pedidos, pedidosDeAdicionales, reemplazosSinEfecto };
}
