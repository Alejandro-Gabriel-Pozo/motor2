/**
 * Fracciones (½, ¼, ⅛) y venta por peso, como Pedernal (docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md, §5, §6, §8 y §12): el
 * NÚCLEO PURO de las reglas. Sin Prisma, sin reloj, sin azar y SIN coma flotante: toda cantidad y todo paso son ENTEROS en diezmilésimos
 * (1 = 10.000; la columna `Decimal(14,4)` de hoy), así que «múltiplo exacto» es un resto entero (decisión técnica T1). Todavía NO está
 * conectado a ninguna pantalla, acción ni columna (no hay `porcionesOfrecidas` ni perilla: eso es E1/E2, con su migración); existe para
 * fijar la regla en un solo lugar y recorrerla contra el oráculo escrito aparte (`test/catalogo/fracciones-y-peso-oraculo.ts`).
 * Referencia en Pedernal: `src/modulos/catalogo/dominio/porciones.ts` y `forma-de-venta.ts` (migración 0051). Se copia el RESULTADO y la
 * FORMA, no el código.
 *
 * Convive con `venta-fraccionada.ts` (`cumplePaso`, `validarPasoVenta`: la regla vigente, con números de coma flotante y tolerancia): este
 * archivo NO la reemplaza ni la toca; cuando se conecte (E1), la regla vigente pasa a apoyarse en esta.
 *
 * Todo nace cerrado (AGENTS.md, 2026-11-11): las formas, las porciones y los motivos son listas de PERMITIDOS; una forma, un valor o una
 * operación desconocida se rechaza con motivo, nunca se redondea ni se acepta «por las dudas».
 *
 * Idempotencia y concurrencia: las funciones son puras, así que repetirlas no cambia nada y no hay carrera dentro de ellas. El bloqueo
 * del producto (`FOR UPDATE`), la versión esperada y el «sin cambios» del guardado los resuelve el caso de uso de E1.
 */

/** 1 unidad = 10.000 diezmilésimos. */
export const ESCALA = 10_000;
/** Un entero (número seguro) que cuenta diezmilésimos. */
export type Diezmilesimos = number;
/** Tope de cantidad por ítem de hoy (`CANTIDAD_MAXIMA_POR_ITEM`, 999); no se cambia sin pedido (T7). */
export const CANTIDAD_MAXIMA = 999 * ESCALA;

/**
 * Lee una cantidad o un paso EXACTOS: un texto decimal con hasta 4 decimales («0,125», «0.5», «3», «-1») o un número que ES esa cantidad con 4
 * decimales (0,3 sí; 0,1 + 0,2 no, porque no es 0,3 en binario: se rechaza en vez de redondearse). Cualquier otra cosa → `null`.
 */
export function leerDiezmilesimos(valor: unknown): Diezmilesimos | null {
  if (typeof valor === "string") {
    const m = /^(-?)(\d{1,9})(?:[.,](\d{1,4}))?$/.exec(valor.trim());
    if (m === null) return null;
    const n = Number(m[2]) * ESCALA + Number((m[3] ?? "").padEnd(4, "0"));
    return m[1] === "-" && n !== 0 ? -n : n;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const entero = Math.round(valor * ESCALA);
    // La división de dos enteros es exacta al redondear: entero / ESCALA es el double más cercano a esa cantidad de 4 decimales; si no es el mismo número, no era esa cantidad.
    return Number.isSafeInteger(entero) && entero / ESCALA === valor ? entero : null;
  }
  return null;
}

// ─── Porciones (½, ¼, ⅛) ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** En cuántas partes se divide el entero: 2 → ½, 4 → ¼, 8 → ⅛. Solo estas tres (dueño, 2026-11-12); tercios y sextos fuera hasta nueva orden. */
export const PORCIONES_PERMITIDAS = [2, 4, 8] as const;
export type Porcion = (typeof PORCIONES_PERMITIDAS)[number];

const esPorcion = (valor: unknown): valor is Porcion => typeof valor === "number" && (PORCIONES_PERMITIDAS as readonly number[]).includes(valor);

/** Los siete conjuntos posibles (I1), ya ordenados y sin repetir. La lista vacía no es un conjunto: es «sin fracciones». */
export const CONJUNTOS_DE_PORCIONES: readonly (readonly Porcion[])[] = [[2], [4], [8], [2, 4], [2, 8], [4, 8], [2, 4, 8]];

/** Las porciones pedidas, en orden ascendente y sin repetir: al menos una, todas permitidas, ninguna dos veces. Si no, `null`. */
export function validarPorciones(porciones: unknown): readonly Porcion[] | null {
  if (!Array.isArray(porciones) || porciones.length === 0 || new Set(porciones).size !== porciones.length) return null;
  if (!porciones.every(esPorcion)) return null;
  return PORCIONES_PERMITIDAS.filter((p) => porciones.includes(p));
}

/** El paso derivado (I2): el de la porción más fina que se ofrece (la mayor): 2 y 8 → ⅛ = 1.250. Exacto: 10.000 / 2, 4 u 8. */
export function pasoDePorciones(porciones: readonly Porcion[]): Diezmilesimos {
  return ESCALA / Math.max(...porciones);
}

// ─── Múltiplo y paso ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ¿La cantidad es múltiplo EXACTO del paso? Con enteros, sin tolerancia. Un paso que no es entero positivo no cumple nada. */
export function esMultiploDelPaso(cantidad: Diezmilesimos, paso: Diezmilesimos): boolean {
  return Number.isSafeInteger(cantidad) && Number.isSafeInteger(paso) && paso > 0 && cantidad % paso === 0;
}

/**
 * Un paso de venta válido por la regla vigente (2026-09-26, que Motor2 conserva; Pedernal no la tiene: diferencia declarada, §15): mayor
 * que cero, hasta 4 decimales (por ser entero) y que `1 ÷ paso` sea un entero (0,5 / 0,25 / 0,2 / 0,125 / 0,1 valen; 0,3 no), así una
 * cantidad entera siempre es válida. En enteros: 10.000 × 10.000 es múltiplo del paso.
 */
export function esPasoValido(paso: unknown): paso is Diezmilesimos {
  return typeof paso === "number" && Number.isSafeInteger(paso) && paso > 0 && paso <= ESCALA && (ESCALA * ESCALA) % paso === 0;
}

// ─── Magnitud de la unidad de stock ─────────────────────────────────────────────────────────────────────────────────────────────

/** `Unidad.magnitud` de hoy. */
export type Magnitud = "CANTIDAD" | "PESO" | "VOLUMEN";

/**
 * Peso en la unidad de stock (Q3, 2026-11-15: «siempre en la unidad de stock»): la venta por peso es de una unidad de masa, y el paso se
 * da a mano EN ESA unidad (no hay unidad de venta aparte ni conversión de precios). Devuelve el motivo de rechazo o `null` si vale.
 */
export function rechazoDePesoEnLaUnidadDeStock(magnitud: Magnitud, paso: unknown): "PESO_SOLO_EN_UNIDAD_DE_MASA" | "PASO_INVALIDO" | null {
  if (magnitud !== "PESO") return "PESO_SOLO_EN_UNIDAD_DE_MASA";
  return esPasoValido(paso) ? null : "PASO_INVALIDO";
}

// ─── Forma de venta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * La forma de venta de un producto (concepto derivado, §5). UNIDAD, FRACCIONES y PESO se pueden elegir; PASO_LIBRE (un paso heredado que no
 * sale de 2, 4 y 8) y MASA_SIN_PASO (unidad de masa sin paso) son lo ya cargado: se muestran tal cual y no se pueden elegir de nuevo.
 */
export type FormaDeVenta =
  | { readonly tipo: "UNIDAD" }
  | { readonly tipo: "FRACCIONES"; readonly porciones: readonly number[] }
  | { readonly tipo: "PESO"; readonly paso: Diezmilesimos }
  | { readonly tipo: "PASO_LIBRE"; readonly paso: Diezmilesimos }
  | { readonly tipo: "MASA_SIN_PASO" };
export const TIPOS_DE_FORMA = ["UNIDAD", "FRACCIONES", "PESO", "PASO_LIBRE", "MASA_SIN_PASO"] as const;

/** El paso efectivo de la forma, o `null` si la forma no es válida o no tiene paso (MASA_SIN_PASO). */
export function pasoDeLaForma(forma: FormaDeVenta): Diezmilesimos | null {
  switch (forma.tipo) {
    case "UNIDAD":
      return ESCALA;
    case "FRACCIONES": {
      const porciones = validarPorciones(forma.porciones);
      return porciones === null ? null : pasoDePorciones(porciones);
    }
    case "PESO":
    case "PASO_LIBRE":
      return esPasoValido(forma.paso) ? forma.paso : null;
    default:
      return null;
  }
}

const formaEsValida = (forma: FormaDeVenta): boolean => forma.tipo === "MASA_SIN_PASO" || pasoDeLaForma(forma) !== null;

/** Una forma válida escrita de una sola manera (las porciones, ordenadas), para compararla. `null` si no es válida. */
function claveDeForma(forma: FormaDeVenta): string | null {
  if (!formaEsValida(forma)) return null;
  if (forma.tipo === "FRACCIONES") return `FRACCIONES:${(validarPorciones(forma.porciones) ?? []).join(",")}`;
  if (forma.tipo === "UNIDAD" || forma.tipo === "MASA_SIN_PASO") return forma.tipo;
  return `${forma.tipo}:${forma.paso}`;
}

/** ¿Es la misma forma? (O18: repetir el mismo cambio, aunque las fracciones lleguen en otro orden, es «sin cambios»). Una forma inválida nunca es igual. */
export function sonLaMismaForma(a: FormaDeVenta, b: FormaDeVenta): boolean {
  const ka = claveDeForma(a);
  return ka !== null && ka === claveDeForma(b);
}

// ─── Cantidad vendible según la forma ───────────────────────────────────────────────────────────────────────────────────────────

export const MOTIVOS_DE_CANTIDAD = ["FORMA_INVALIDA", "CANTIDAD_INVALIDA", "CANTIDAD_FUERA_DE_RANGO", "SOLO_CANTIDADES_ENTERAS", "NO_ES_MULTIPLO_DEL_PASO"] as const;
export type MotivoDeCantidad = (typeof MOTIVOS_DE_CANTIDAD)[number];

export interface EntradaDeCantidad {
  readonly forma: FormaDeVenta;
  /** Lo que llega del cliente: un texto decimal o un número. Se lee exacto; nunca se redondea. */
  readonly cantidad: unknown;
  /** La perilla «Fracciones y peso» de la empresa (nace apagada). */
  readonly perillaEncendida: boolean;
}

export type DecisionDeCantidad = { readonly ok: true; readonly cantidad: Diezmilesimos } | { readonly ok: false; readonly motivo: MotivoDeCantidad };
const noVale = (motivo: MotivoDeCantidad): DecisionDeCantidad => ({ ok: false, motivo });

/**
 * ¿Se puede vender esta cantidad con esta forma? (I5, I7, O1 a O6, O16). Una cantidad es válida si es un múltiplo exacto del paso; una
 * entera siempre; NUNCA se redondea en silencio. VENDER lo ya cargado como FRACCIONES o PESO no pide la perilla (una baja no corta la
 * venta de lo que existe); el PASO_LIBRE heredado SÍ la pide (2026-11-15: «Sí, también frena el paso libre»): apagada, solo enteras.
 * MASA_SIN_PASO (la unidad de masa sin paso de hoy) no tiene paso que cumplir: se acepta toda cantidad exacta y positiva y la unidad de
 * stock sigue decidiendo sus decimales (supuesto declarado: el diseño dice «sin cambio»; NO VERIFICADO punta a punta).
 */
export function decidirCantidadVendible(entrada: EntradaDeCantidad): DecisionDeCantidad {
  const { forma, perillaEncendida } = entrada;
  if (forma === null || typeof forma !== "object" || !(TIPOS_DE_FORMA as readonly string[]).includes(forma.tipo) || !formaEsValida(forma)) return noVale("FORMA_INVALIDA");
  const cantidad = leerDiezmilesimos(entrada.cantidad);
  if (cantidad === null) return noVale("CANTIDAD_INVALIDA");
  if (cantidad <= 0 || cantidad > CANTIDAD_MAXIMA) return noVale("CANTIDAD_FUERA_DE_RANGO");
  const paso = pasoDeLaForma(forma);
  if (paso === null) return { ok: true, cantidad }; // MASA_SIN_PASO
  if (forma.tipo === "PASO_LIBRE" && !perillaEncendida && cantidad % ESCALA !== 0) return noVale("SOLO_CANTIDADES_ENTERAS");
  return esMultiploDelPaso(cantidad, paso) ? { ok: true, cantidad } : noVale("NO_ES_MULTIPLO_DEL_PASO");
}

// ─── Cargar una forma (cambiar la forma de venta del producto) ──────────────────────────────────────────────────────────────────

export const MOTIVOS_DE_CARGA = [
  "FORMA_HEREDADA_NO_SE_ELIGE",
  "SOLO_PRODUCTOS_DE_VENTA",
  "FRACCIONES_SOLO_POR_UNIDAD",
  "PORCIONES_INVALIDAS",
  "PESO_SOLO_EN_UNIDAD_DE_MASA",
  "PASO_INVALIDO",
  "PERILLA_APAGADA",
] as const;
export type MotivoDeCarga = (typeof MOTIVOS_DE_CARGA)[number];

export interface EntradaDeCarga {
  /** La forma que se quiere dejar. */
  readonly destino: FormaDeVenta;
  /** El producto es de venta (`tipo = PV` hoy; clase que vende mañana). */
  readonly esProductoDeVenta: boolean;
  /** `Unidad.magnitud` de la unidad de stock del producto. */
  readonly magnitud: Magnitud;
  readonly perillaEncendida: boolean;
}
export type DecisionDeCarga = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoDeCarga };
const noSeCarga = (motivo: MotivoDeCarga): DecisionDeCarga => ({ ok: false, motivo });

/**
 * ¿Se puede dejar al producto en esta forma? (I3, I4, I7, O15, O17). Volver a UNIDAD siempre se puede (una baja no pide la perilla).
 * Cargar FRACCIONES o PESO pide: producto de venta, la unidad que corresponde (conteo / masa), datos válidos y la perilla encendida,
 * en ese orden (el primer motivo que falla es el que se informa: supuesto declarado, el orden de Pedernal es NO VERIFICADO).
 * Las formas heredadas no se pueden elegir de nuevo (§5).
 */
export function decidirCargarForma(entrada: EntradaDeCarga): DecisionDeCarga {
  const { destino, esProductoDeVenta, magnitud, perillaEncendida } = entrada;
  switch (destino?.tipo) {
    case "UNIDAD":
      return { ok: true };
    case "FRACCIONES":
      if (!esProductoDeVenta) return noSeCarga("SOLO_PRODUCTOS_DE_VENTA");
      if (magnitud !== "CANTIDAD") return noSeCarga("FRACCIONES_SOLO_POR_UNIDAD");
      if (validarPorciones(destino.porciones) === null) return noSeCarga("PORCIONES_INVALIDAS");
      return perillaEncendida ? { ok: true } : noSeCarga("PERILLA_APAGADA");
    case "PESO": {
      if (!esProductoDeVenta) return noSeCarga("SOLO_PRODUCTOS_DE_VENTA");
      const motivo = rechazoDePesoEnLaUnidadDeStock(magnitud, destino.paso);
      if (motivo !== null) return noSeCarga(motivo);
      return perillaEncendida ? { ok: true } : noSeCarga("PERILLA_APAGADA");
    }
    case "PASO_LIBRE":
    case "MASA_SIN_PASO":
      return noSeCarga("FORMA_HEREDADA_NO_SE_ELIGE");
    default:
      return noSeCarga("FORMA_HEREDADA_NO_SE_ELIGE"); // todo nace cerrado: una forma que no se declara no se carga
  }
}
