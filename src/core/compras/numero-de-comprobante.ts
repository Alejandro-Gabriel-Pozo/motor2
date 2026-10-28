/**
 * E3a: la clave NORMALIZADA del número de un comprobante de proveedor (`FacturaProveedor.nroFacturaNormalizado`), la que entra en el índice único
 * `FacturaProveedor_unica_vigente_key` (empresa + proveedor + letra + número normalizado, de las facturas vigentes; ADR-029 §3). El número tal cual se tecleó se guarda aparte.
 *
 * Qué hace iguales a dos formas de escribir el MISMO comprobante: los ceros a la izquierda de cada grupo de dígitos y los separadores. «0001-00001234», «1-1234», «0001 1234» y
 * «1/1234» dan «1-1234». Una letra de comprobante al principio (A, B, C, E, M o X, seguida de un separador o de un dígito) se conserva como prefijo («A-0001-00000077» → «A:1-77»),
 * así dos comprobantes de distinta letra con el mismo número no chocan. Lo que no tiene uno o dos grupos de dígitos (un texto libre como «REMITO SN») queda en mayúsculas y sin
 * espacios: solo choca con la misma escritura.
 *
 * Criterio conservador: ante la duda NO iguala (un falso «ya está cargada» frenaría una carga legítima; un duplicado no detectado igual lo ve el aviso de posible duplicado).
 */
export function normalizarNumeroDeComprobante(numero: string): string {
  const limpio = numero.trim().toUpperCase();
  const letra = /^([ABCEMX])(?=[\s\-/.:]*\d)/.exec(limpio)?.[1] ?? null;
  const resto = letra ? limpio.slice(1) : limpio;
  const grupos = resto.match(/\d+/g) ?? [];
  const soloDigitosYSeparadores = /^[\s\-/.:\d]+$/.test(resto);
  if (soloDigitosYSeparadores && (grupos.length === 1 || grupos.length === 2)) {
    const numeroNormalizado = grupos.map((g) => g.replace(/^0+(?=\d)/, "")).join("-");
    return letra ? `${letra}:${numeroNormalizado}` : numeroNormalizado;
  }
  return limpio.replace(/\s+/g, "");
}
