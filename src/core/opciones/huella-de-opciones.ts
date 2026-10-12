import { createHash } from "node:crypto";
import { redondearMoneda } from "@/core/moneda";

/**
 * La HUELLA de las opciones que van DENTRO del precio de una línea (GO-0b; diseño §2.10): el SHA-256 en hexadecimal (64 caracteres) del canónico ordenado
 * `[{opcionId, versionDeOpcionId, cantidad, importeUnitario, factorEscala}]`. Dos líneas con las mismas opciones, en las mismas versiones y al mismo importe tienen la
 * misma huella; cualquier diferencia (otra opción, otra versión, otra cantidad, otro importe, otro factor) la cambia. Sin opciones devuelve `null`: es lo que se
 * guarda en `CuentaItem.huellaOpciones` y lo que deja la clave de agrupación igual a la de hoy.
 *
 * Determinista y sin depender del ORDEN de entrada: el canónico se ordena por opción (y, si hiciera falta, por versión y cantidad) con comparación de código de caracteres, nunca
 * por idioma. Los números se escriben con decimales fijos (importe con 2, factor con 4, como las columnas `DECIMAL(14,2)` y `DECIMAL(8,4)`), así `150` y `150.00` no dan huellas
 * distintas. Solo van las opciones dentro del precio (MEDIDA, VARIANTE, INCLUIDA): el ADICIONAL es otra línea y no entra.
 */
export interface OpcionParaHuella {
  opcionId: string;
  versionDeOpcionId: string;
  cantidad: number;
  importeUnitario: number;
  factorEscala: number | null;
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function huellaDeOpciones(opciones: readonly OpcionParaHuella[]): string | null {
  if (opciones.length === 0) return null;

  for (const o of opciones) {
    if (!Number.isFinite(o.cantidad) || !Number.isFinite(o.importeUnitario) || (o.factorEscala !== null && !Number.isFinite(o.factorEscala))) {
      throw new RangeError(`La huella de opciones necesita números finitos (opción ${o.opcionId}).`);
    }
  }

  const canonico = [...opciones]
    .sort((a, b) => comparar(a.opcionId, b.opcionId) || comparar(a.versionDeOpcionId, b.versionDeOpcionId) || a.cantidad - b.cantidad)
    .map((o) => ({
      opcionId: o.opcionId,
      versionDeOpcionId: o.versionDeOpcionId,
      cantidad: o.cantidad,
      importeUnitario: redondearMoneda(o.importeUnitario).toFixed(2),
      factorEscala: o.factorEscala === null ? null : o.factorEscala.toFixed(4),
    }));
  return createHash("sha256").update(JSON.stringify(canonico)).digest("hex");
}
