import type { CodigoCorregirImportes } from "@/core/features/compras/compra.schema";
import { precioPorUnidad } from "@/core/movimientos/public";

/**
 * Reglas de la CORRECCIÓN DE IMPORTES de una compra por ejemplar (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md). Módulo PURO: sin base de datos ni permisos.
 *
 * Corregir el importe de un renglón NO mueve stock: el ejemplar nuevo lleva las mismas cantidades, productos, secciones y lotes que el original y solo cambia el importe (con IVA incluido) de los renglones
 * pedidos. Por eso nunca depende de que lo comprado siga en stock (a diferencia de anular). El original queda anulado con su contra-asiento y el ejemplar nuevo lo reemplaza (lo escribe el caso de uso).
 *
 * DINERO: el importe llega en CENTAVOS ENTEROS (nunca decimales flotantes) y se compara en centavos. El precio por unidad de stock se calcula con la misma regla que la carga (`precioPorUnidad`: importe ÷ cantidad,
 * 4 decimales, mitad hacia arriba). Un importe de `0` no se acepta como corrección: «$0 = sin dato» (decisión del dueño) y corregir es completar o cambiar por un importe real.
 */

/** El tope de la columna `precioTotal` (DECIMAL(14,2)) con holgura: 999.999.999,99 pesos. */
export const IMPORTE_MAXIMO_EN_CENTAVOS = 99_999_999_999;

/** Un renglón de la compra vigente, como está guardado (importes en pesos con dos decimales). */
export interface RenglonVigente {
  movimientoId: string;
  productoId: string;
  productoNombre: string;
  seccionId: string;
  loteVencimiento: Date | null;
  cantidad: number;
  detalle: string;
  precioTotal: number;
}

/** Lo que pidió la persona: el importe NUEVO del renglón, con IVA incluido, en centavos enteros. */
export interface ImporteCorregidoPedido {
  movimientoId: string;
  importeEnCentavos: number;
}

/** Un renglón del ejemplar nuevo: todo igual al original salvo, si cambió, el importe y el precio por unidad. */
export interface LineaCorregida {
  movimientoId: string;
  productoId: string;
  productoNombre: string;
  seccionId: string;
  loteVencimiento: Date | null;
  cantidad: number;
  detalle: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  cambio: boolean;
}

export interface CambioDeImporte {
  movimientoId: string;
  productoNombre: string;
  anteriorEnCentavos: number;
  nuevoEnCentavos: number;
}

export type ResultadoCorreccionDeImportes =
  | { ok: true; lineas: LineaCorregida[]; cambios: CambioDeImporte[]; totalAntesEnCentavos: number; totalDespuesEnCentavos: number }
  | { ok: false; codigo: Extract<CodigoCorregirImportes, "SIN_RENGLONES" | "SIN_CAMBIOS" | "ENTRADA_INVALIDA">; mensaje: string };

const aCentavos = (pesos: number): number => Math.round(pesos * 100);
const aPesos = (centavos: number): number => centavos / 100;

export function evaluarCorreccionDeImportes(vigentes: readonly RenglonVigente[], pedidos: readonly ImporteCorregidoPedido[]): ResultadoCorreccionDeImportes {
  if (vigentes.length === 0) return { ok: false, codigo: "SIN_RENGLONES", mensaje: "Esa compra no tiene renglones que corregir." };
  if (pedidos.length === 0) return { ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "Indicá el importe que querés corregir." };

  const pedidoPorRenglon = new Map<string, number>();
  for (const p of pedidos) {
    if (pedidoPorRenglon.has(p.movimientoId)) return { ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "Un renglón vino repetido: mandá un solo importe por renglón." };
    if (!vigentes.some((v) => v.movimientoId === p.movimientoId)) return { ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "Uno de los renglones no es de esta compra." };
    if (!Number.isInteger(p.importeEnCentavos) || p.importeEnCentavos < 1 || p.importeEnCentavos > IMPORTE_MAXIMO_EN_CENTAVOS) {
      return { ok: false, codigo: "ENTRADA_INVALIDA", mensaje: "El importe tiene que ser mayor que cero y no pasar de $999.999.999,99." };
    }
    pedidoPorRenglon.set(p.movimientoId, p.importeEnCentavos);
  }

  const cambios: CambioDeImporte[] = [];
  const lineas: LineaCorregida[] = vigentes.map((v) => {
    const anterior = aCentavos(v.precioTotal);
    const pedido = pedidoPorRenglon.get(v.movimientoId);
    const nuevo = pedido ?? anterior;
    const cambio = pedido !== undefined && pedido !== anterior;
    if (cambio) cambios.push({ movimientoId: v.movimientoId, productoNombre: v.productoNombre, anteriorEnCentavos: anterior, nuevoEnCentavos: nuevo });
    return {
      movimientoId: v.movimientoId,
      productoId: v.productoId,
      productoNombre: v.productoNombre,
      seccionId: v.seccionId,
      loteVencimiento: v.loteVencimiento,
      cantidad: v.cantidad,
      detalle: v.detalle,
      precioTotal: aPesos(nuevo),
      precioPorUnidadStock: precioPorUnidad(aPesos(nuevo), v.cantidad),
      cambio,
    };
  });

  if (cambios.length === 0) return { ok: false, codigo: "SIN_CAMBIOS", mensaje: "La compra ya tiene esos importes: no hay nada que corregir." };

  const totalAntesEnCentavos = vigentes.reduce((s, v) => s + aCentavos(v.precioTotal), 0);
  const totalDespuesEnCentavos = lineas.reduce((s, l) => s + aCentavos(l.precioTotal), 0);
  return { ok: true, lineas, cambios, totalAntesEnCentavos, totalDespuesEnCentavos };
}

const pesos = (centavos: number) => `$${aPesos(centavos).toLocaleString("es-AR", { minimumFractionDigits: centavos % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** «Factura corregida: importe de Cerveza (de $144.000 a $150.000). La original queda en el historial.» */
export function mensajeCorreccionDeImportes(cambios: readonly CambioDeImporte[], nroFactura: string | null): string {
  const detalle = cambios.map((c) => `${c.productoNombre} (de ${pesos(c.anteriorEnCentavos)} a ${pesos(c.nuevoEnCentavos)})`).join(", ");
  const de = nroFactura ? ` ${nroFactura}` : "";
  return `Factura${de} corregida: importe de ${detalle}. La original queda en el historial.`;
}
