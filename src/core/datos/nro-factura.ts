import { LARGO_MAXIMO_NRO_FACTURA, texto } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

const RE_ALFANUMERICO = /[\p{L}\p{N}]/u;

/**
 * N.º de factura del proveedor: texto libre (`#`, `/`, `*` o un `-` inicial son válidos, ver test/core/nro-factura.test.ts), recortado;
 * vacío → `null` (compra sin número). Se acota el largo y se exige al menos una letra o un número ("---" no identifica ninguna factura).
 * No cambia ninguna otra normalización: el valor es la clave del índice `Operacion_factura_unica_vigente_key`.
 */
export function validarNroFactura(valor: unknown): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return aceptar(null);
  if (v.length > LARGO_MAXIMO_NRO_FACTURA) return rechazar("largo", `El número de factura no puede superar los ${LARGO_MAXIMO_NRO_FACTURA} caracteres.`);
  if (!RE_ALFANUMERICO.test(v)) return rechazar("sin_alfanumerico", "El número de factura tiene que tener al menos una letra o un número.");
  return aceptar(v);
}
