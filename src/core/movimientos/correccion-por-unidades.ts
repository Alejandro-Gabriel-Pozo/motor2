import { Decimal } from "decimal.js";
import { repartirImporte } from "@/core/moneda";
import { evaluarPosterioresAAnularVenta, type LineaVendida, type PosterioresALaVenta } from "@/core/movimientos/anulaciones";

/**
 * Corrección de una venta QUITANDO UNIDADES de la línea de un ticket cerrado (etapa E1 de docs/diseno-correccion-por-ajuste-2026-11-06.md,
 * §3 niveles 4 y 5; plan B-REHACER de motor2-docs). «Cobré 2 cervezas y la mesa tomó 1».
 *
 * Reglas PURAS (sin base, sin reloj): la persistencia y el caso de uso van aparte. El mecanismo, en una sola transacción: el contra-asiento R de la
 * venta A (lo que ya hace `construirReversionDeVenta`), la venta nueva B (lo que arma `copiarVentaConMenosUnidades`: lo que queda de A, en
 * proporción) y la marca en A. Como A + R = 0 exacto, el efecto neto de la corrección es B − A.
 *
 * Congelado (I9, decisión 5 del dueño): B copia de A el precio por unidad, el precio de lista y el costo de la venta SIN recalcular nada; un importe
 * en $0 o un costo vacío se copian tal cual («sin dato»). Lo único que se reparte es lo que depende de la cantidad: las cantidades de stock (por lote,
 * mayor residuo, suma exacta) y los importes (`repartirImporte`, centavos exactos).
 */

/** Una fila de la venta A tal como se guardó: `LineaVendida` más lo congelado que B tiene que repetir. */
export interface LineaParaCorregir extends LineaVendida {
  costoUnitarioVenta: number | null;
  precioListaUnitario: number | null;
  sustituyeAProductoId: string | null;
}

/** Una fila de la venta B: la misma forma que la de A (estructural: el caso de uso la completa con la operación y la escribe). */
export type FilaCorregida = LineaParaCorregir;

/** Cuántas unidades vendió la venta: la suma de las filas VENTA (una por lote) en valor absoluto. */
export function unidadesVendidas(lineas: readonly Pick<LineaVendida, "proceso" | "cantidad">[]): number {
  return lineas.filter((l) => l.proceso === "VENTA").reduce((s, l) => s + Math.abs(l.cantidad), 0);
}

/** Clon propio de decimal.js (mismo patrón que `core/moneda.ts`): los productos de pasos × pasos pueden pasar de 2^53. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Reparte `total` (entero no negativo) en proporción a `pesos` (enteros no negativos) por mayor residuo: la suma da `total` exacto. Sin pesos positivos, todo en 0. */
function repartirEnteros(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (suma === 0) return pesos.map(() => 0);
  const exactos = pesos.map((p) => new D(total).times(p).dividedBy(suma));
  const pisos = exactos.map((e) => e.floor().toNumber());
  const restos = exactos.map((e, i) => ({ i, resto: e.minus(pisos[i]).toNumber() }));
  restos.sort((x, y) => y.resto - x.resto || x.i - y.i);
  let faltan = total - pisos.reduce((s, v) => s + v, 0);
  for (const { i } of restos) {
    if (faltan <= 0) break;
    pisos[i] += 1;
    faltan -= 1;
  }
  return pisos;
}

/** Pasa una cantidad a «pasos» enteros de la unidad (10^decimales) sin errores de coma flotante (redondeo al más cercano). */
const aPasos = (cantidad: number, decimales: number): number => new D(Math.abs(cantidad)).times(10 ** decimales).toDecimalPlaces(0).toNumber();
const dePasos = (pasos: number, decimales: number): number => new D(pasos).dividedBy(10 ** decimales).toNumber();

export interface ParametrosDeLaCopia {
  /** Cuántas unidades vendía A (`unidadesVendidas`). */
  unidadesOriginales: number;
  /** Cuántas se quitan: entero, de 1 a `unidadesOriginales − 1` (quitarlas todas es anular la línea entera: no hay B). */
  unidadesAQuitar: number;
  /** Los decimales de la unidad de stock de cada producto (`Unidad.decimales`): hasta ahí se reparten las cantidades. */
  decimalesDe: (productoId: string) => number;
}

/**
 * Las filas de la venta B: lo que queda de A después de quitar `unidadesAQuitar`, en el mismo orden, con los mismos lotes, secciones, precios por
 * unidad, precio de lista y costo congelado. Dentro de cada grupo (producto, sección, proceso, sustituto) las cantidades se reparten entre los lotes en
 * proporción a lo que A tenía en cada uno (mayor residuo, suma exacta) y los importes entre las filas con `repartirImporte`. Una fila que queda en 0
 * unidades (el lote se vació) no se escribe, salvo la liquidación de consignación, que por definición lleva cantidad 0.
 *
 * Lanza un error si los parámetros no cumplen lo anterior: `evaluarCorreccionPorUnidades` ya los validó, esto es la última defensa.
 */
export function copiarVentaConMenosUnidades(lineas: readonly LineaParaCorregir[], p: ParametrosDeLaCopia): FilaCorregida[] {
  const { unidadesOriginales, unidadesAQuitar } = p;
  if (!Number.isInteger(unidadesAQuitar) || unidadesAQuitar < 1 || unidadesAQuitar >= unidadesOriginales) {
    throw new Error("copiarVentaConMenosUnidades: se quitan de 1 a (unidades − 1) unidades enteras.");
  }
  const quedan = unidadesOriginales - unidadesAQuitar;
  const claveDeGrupo = (l: LineaParaCorregir) => `${l.productoId}|${l.seccionId}|${l.proceso}|${l.sustituyeAProductoId ?? ""}`;

  const grupos = new Map<string, number[]>();
  lineas.forEach((l, i) => grupos.set(claveDeGrupo(l), [...(grupos.get(claveDeGrupo(l)) ?? []), i]));

  const cantidadB = new Array<number>(lineas.length).fill(0);
  const importeB = new Array<number>(lineas.length).fill(0);
  const exactaB = new Array<number | null>(lineas.length).fill(null);

  for (const indices of grupos.values()) {
    const decimales = p.decimalesDe(lineas[indices[0]].productoId);
    const pesos = indices.map((i) => aPasos(lineas[i].cantidad, decimales));
    const totalPasos = pesos.reduce((s, v) => s + v, 0);
    // Lo que queda del grupo: la misma proporción que de las unidades vendidas (la venta se reduce por igual en todo lo que consumió).
    const objetivo = new D(totalPasos).times(quedan).dividedBy(unidadesOriginales).toDecimalPlaces(0).toNumber();
    const pasosB = repartirEnteros(objetivo > totalPasos ? totalPasos : objetivo, pesos);

    const importeA = indices.reduce((s, i) => s + lineas[i].precioTotal, 0);
    const signo = importeA < 0 ? -1 : 1;
    const [importeQueda] = repartirImporte(Math.abs(importeA), [quedan, unidadesAQuitar]);
    // Entre las filas del grupo, en proporción a lo que cada una conserva; las que no llevan cantidad (la liquidación de consignación), por el importe que tenía A.
    const pesosDeImporte = pasosB.some((v) => v > 0) ? pasosB : indices.map((i) => Math.abs(lineas[i].precioTotal));
    const importes = repartirImporte(importeQueda, pesosDeImporte);

    indices.forEach((i, k) => {
      const l = lineas[i];
      const signoCantidad = l.cantidad < 0 ? -1 : 1;
      cantidadB[i] = signoCantidad * dePasos(pasosB[k], decimales);
      importeB[i] = signo * importes[k];
      // El arrastre de redondeo (Task #27) se escala igual: solo se llena si difiere de lo que se escribe.
      if (l.cantidadExacta !== null && totalPasos > 0) {
        const escalada = Math.round(((l.cantidadExacta * quedan) / unidadesOriginales) * 1e8) / 1e8;
        exactaB[i] = Math.abs(escalada - cantidadB[i]) < 1e-9 ? null : escalada;
      }
    });
  }

  return lineas.flatMap((l, i) => {
    if (cantidadB[i] === 0 && l.proceso !== "LIQUIDACION_CONSIGNACION") return [];
    return [{ ...l, cantidad: sinCeroNegativo(cantidadB[i]), cantidadExacta: exactaB[i], precioTotal: sinCeroNegativo(importeB[i]) }];
  });
}

const sinCeroNegativo = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** El efecto neto en el stock de reemplazar A por B, por (producto, sección, lote): B − A. Es lo que vuelve (positivo) o sale (negativo) del stock con la corrección. */
export function diferenciaDeStock(
  a: readonly Pick<LineaVendida, "productoId" | "seccionId" | "loteVencimiento" | "cantidad">[],
  b: readonly Pick<LineaVendida, "productoId" | "seccionId" | "loteVencimiento" | "cantidad">[]
): Map<string, number> {
  const clave = (l: Pick<LineaVendida, "productoId" | "seccionId" | "loteVencimiento">) => `${l.productoId}|${l.seccionId}|${l.loteVencimiento ? l.loteVencimiento.toISOString().slice(0, 10) : ""}`;
  const neto = new Map<string, number>();
  for (const l of b) neto.set(clave(l), (neto.get(clave(l)) ?? 0) + l.cantidad);
  for (const l of a) neto.set(clave(l), (neto.get(clave(l)) ?? 0) - l.cantidad);
  // Cantidades con hasta 4 decimales (Decimal(14,4)): se limpia el ruido de la resta en coma flotante.
  return new Map([...neto].map(([k, v]) => [k, Math.round(v * 1e4) / 1e4] as const));
}

/** La venta A, tal como la ve la decisión: lo que cambia la regla (no las filas). */
export interface VentaParaCorregirPorUnidades {
  proceso: string;
  anuladaEn: Date | null;
  /** Alguna otra venta ya la reemplaza (`reemplazaAOperacionId`): el índice único de la base solo deja una. */
  yaReemplazada: boolean;
  promoCuentaId: string | null;
  /** No nulo = esta venta es un ADICIONAL (cuelga de la de su producto). */
  operacionPadreId: string | null;
  /** Ids de los adicionales vigentes que cuelgan de esta venta. */
  hijasVigentes: readonly string[];
  /** Cuántas unidades vende hoy (`unidadesVendidas`). */
  unidades: number;
}

/** Cómo llega el envío respecto de la clave de idempotencia (I3): primera vez, repetido con el mismo contenido, o la misma clave con otro contenido. */
export type RepeticionDelEnvio = "NUEVA" | "MISMA_CLAVE_IGUAL" | "MISMA_CLAVE_DISTINTA";

export interface EntradaDeLaCorreccion {
  permisos: { anularVenta: boolean; emitirTicketCorregido: boolean };
  repeticion: RepeticionDelEnvio;
  venta: VentaParaCorregirPorUnidades;
  /** Cuántas unidades vendidas vio la persona al pedir la corrección (guarda optimista). */
  unidadesVistas: number;
  unidadesAQuitar: number;
  posteriores: PosterioresALaVenta;
}

export type MotivoDeRechazoDeLaCorreccion =
  | "SIN_PERMISO"
  | "CLAVE_REUTILIZADA"
  | "NO_ES_VENTA"
  | "YA_ANULADA"
  | "LA_VENTA_CAMBIO"
  | "ES_PROMO"
  | "ES_ADICIONAL"
  | "CON_ADICIONALES"
  | "UNIDADES_INVALIDAS"
  | "CONTEO_POSTERIOR"
  | "PAGO_CONSIGNANTE_POSTERIOR";

/**
 * - `PARCIAL`: se escribe R + B + marca + ejemplar siguiente.
 * - `TOTAL`: se quitan todas las unidades: es anular la línea entera (la corrección de E0, sin B); el llamador la deriva a ese camino.
 * - `REPETIDA`: ya se hizo con esta misma clave: se devuelve el mensaje guardado, sin escribir nada.
 */
export type ResultadoDeLaCorreccion =
  | { ok: true; alcance: "PARCIAL" | "TOTAL" | "REPETIDA" }
  | { ok: false; motivo: MotivoDeRechazoDeLaCorreccion; mensaje: string };

const rechazo = (motivo: MotivoDeRechazoDeLaCorreccion, mensaje: string): ResultadoDeLaCorreccion => ({ ok: false, motivo, mensaje });

/** El mensaje cuando otra persona (u otra pestaña) ya cambió la venta: la corrección que se pidió se hizo sobre algo que ya no está. */
const MENSAJE_LA_VENTA_CAMBIO = "La venta cambió mientras la corregías: volvé a abrir la cuenta, revisá lo que quedó y volvé a intentar.";

/**
 * La decisión completa de «quitar unidades de una línea de un ticket cerrado», en el orden en que se evalúa (el primero que falla manda, un solo motivo
 * por rechazo): permisos (`anular_venta` y `pos_emitir_ticket_corregido`) → repetición con la clave de idempotencia → que sea una venta vigente →
 * que no haya cambiado desde lo que se vio → promo y adicionales → que las unidades sean válidas → conteo o pago a consignante posterior (D7).
 * Quitar todas las unidades no es un error: es la anulación de la línea entera (`alcance: "TOTAL"`).
 *
 * Supuesto declarado: un adicional se corrige junto con su producto; mientras no esté definido cuántos adicionales quedan al quitar unidades del producto,
 * una venta con adicionales vigentes (y un adicional suelto) se rechaza por unidades y se corrige la línea entera. Pendiente de confirmar por el dueño.
 */
export function evaluarCorreccionPorUnidades(e: EntradaDeLaCorreccion): ResultadoDeLaCorreccion {
  if (!e.permisos.anularVenta || !e.permisos.emitirTicketCorregido) {
    return rechazo("SIN_PERMISO", "No tenés permiso para corregir una venta: hace falta poder anular ventas y emitir tickets corregidos.");
  }
  if (e.repeticion === "MISMA_CLAVE_DISTINTA") {
    return rechazo("CLAVE_REUTILIZADA", "Este envío ya se usó con otros datos: volvé a abrir la corrección y confirmala de nuevo.");
  }
  if (e.repeticion === "MISMA_CLAVE_IGUAL") return { ok: true, alcance: "REPETIDA" };

  const v = e.venta;
  if (v.proceso !== "VENTA") return rechazo("NO_ES_VENTA", `Esta operación no es una venta: es "${v.proceso}".`);
  if (v.yaReemplazada) return rechazo("LA_VENTA_CAMBIO", MENSAJE_LA_VENTA_CAMBIO);
  if (v.anuladaEn) return rechazo("YA_ANULADA", "Esta venta ya está anulada.");
  if (e.unidadesVistas !== v.unidades) return rechazo("LA_VENTA_CAMBIO", MENSAJE_LA_VENTA_CAMBIO);

  if (v.promoCuentaId) return rechazo("ES_PROMO", "Esta línea es parte de una promo: no se corre por unidades. Corregí la promo entera.");
  if (v.operacionPadreId) return rechazo("ES_ADICIONAL", "Un adicional se corrige junto con su producto: corregí la línea del producto.");
  if (v.hijasVigentes.length) return rechazo("CON_ADICIONALES", "Esta línea tiene adicionales: por ahora se corrige la línea entera, no por unidades.");

  if (!Number.isInteger(e.unidadesAQuitar) || e.unidadesAQuitar < 1 || e.unidadesAQuitar > v.unidades) {
    return rechazo("UNIDADES_INVALIDAS", `Las unidades a quitar tienen que ser un número entero de 1 a ${v.unidades}.`);
  }

  const posteriores = evaluarPosterioresAAnularVenta(e.posteriores);
  if (!posteriores.ok) return rechazo(posteriores.motivo === "PAGO_CONSIGNANTE_POSTERIOR" ? "PAGO_CONSIGNANTE_POSTERIOR" : "CONTEO_POSTERIOR", posteriores.mensaje);

  return { ok: true, alcance: e.unidadesAQuitar === v.unidades ? "TOTAL" : "PARCIAL" };
}
