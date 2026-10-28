import { importeDeLinea } from "@/core/moneda";

/**
 * E2 «el costo viaja con el traspaso» (ADR-040, docs/diseno-costo-en-el-traspaso-2026-10-27.md): cómo se valoriza CADA línea de Kardex de un traspaso entre sucursales
 * (la salida del origen, la entrada del destino y el reingreso) a partir de la COPIA del costo del origen que el traspaso guardó al enviarse
 * (`TraspasoSucursal.costoUnitarioOrigen`).
 *
 * - Con copia: `precioPorUnidadStock` = la copia EXACTA (misma precisión, DECIMAL(14,4)) y `precioTotal` = |cantidad| × copia en decimal exacto, con UN solo redondeo a
 *   centavos (`importeDeLinea`). El importe va siempre en positivo: el signo del movimiento lo lleva la cantidad (el CHECK de la base solo admite importes negativos en
 *   AJUSTE y LIQUIDACION_CONSIGNACION).
 * - Sin copia (`null`: el origen no tenía costo conocido, o el traspaso es anterior a la columna): las dos en 0, la convención de siempre de «sin precio» que los
 *   lectores del costo excluyen con `> 0`. El destino queda «pendiente de completar»: nunca se inventa un costo.
 *
 * Una copia negativa o no finita es un error de programación (la base la rechaza con su CHECK): se lanza antes de escribir.
 */
export interface ValorDeLineaDeTraspaso {
  precioPorUnidadStock: number;
  precioTotal: number;
}

export function valorizarLineaDeTraspaso(cantidadConSigno: number, costoUnitarioOrigen: number | null): ValorDeLineaDeTraspaso {
  if (costoUnitarioOrigen === null) return { precioPorUnidadStock: 0, precioTotal: 0 };
  if (!Number.isFinite(costoUnitarioOrigen) || costoUnitarioOrigen < 0) throw new Error(`Costo unitario de origen inválido: ${costoUnitarioOrigen}.`);
  if (!Number.isFinite(cantidadConSigno)) throw new Error(`Cantidad de traspaso inválida: ${cantidadConSigno}.`);
  return { precioPorUnidadStock: costoUnitarioOrigen, precioTotal: importeDeLinea(Math.abs(cantidadConSigno), costoUnitarioOrigen) };
}
