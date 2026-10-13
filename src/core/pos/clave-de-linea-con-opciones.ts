import { claveDeLineaDeVenta } from "./cuenta";

/**
 * La clave de agrupación de una línea de venta EXTENDIDA con opciones (GO-0b; diseño §2.11, invariante I8). Deja escrita la pieza pura que GO-2 va a usar en
 * `lineasDeVenta`, `cerrarCuenta`, el ticket y «Tickets emitidos»; hoy NADIE de producción la llama (solo los tests): `claveDeLineaDeVenta` y `lineasDeVenta` siguen igual.
 *
 * - Sin opciones (ni huella ni padre) la clave es EXACTAMENTE la de `claveDeLineaDeVenta`, byte a byte: lo de hoy no se mueve.
 * - Una línea configurada (con `huellaOpciones`): la clave de siempre + `|h:<huella>`. Así «café cortado» y «café con leche» al mismo precio no se juntan en UNA operación.
 * - Un adicional (con `clavePadre`, la clave de la línea del producto de la que cuelga): la clave de siempre + `|a:<clave de la línea padre>`. Cada adicional queda ligado
 *   a la configuración de su padre.
 * - Un adicional no lleva huella (no tiene opciones dentro del precio): pasar las dos es un error de quien llama y falla en vez de adivinar.
 */
export type ClaveDeLineaConOpciones = { productoId: string; precioUnitario: number; promoCuentaId?: string | null; precioCartaUnitario?: number | null } & (
  | { huellaOpciones?: string | null; clavePadre?: null }
  | { huellaOpciones?: null; clavePadre: string }
);

/** Lo que `CuentaItem.huellaOpciones` admite (CHECK `~ '^[0-9a-f]{64}$'`). */
const HUELLA = /^[0-9a-f]{64}$/;

export function claveDeLineaDeVentaConOpciones(l: ClaveDeLineaConOpciones): string {
  const clave = claveDeLineaDeVenta(l);
  const huella = l.huellaOpciones ?? null;
  const clavePadre = l.clavePadre ?? null;
  if (huella !== null && clavePadre !== null) throw new Error("Una línea no puede ser a la vez configurada (huella) y adicional (padre).");
  if (huella !== null) {
    if (!HUELLA.test(huella)) throw new Error("La huella de opciones tiene que ser un SHA-256 en hexadecimal minúscula (64 caracteres).");
    return `${clave}|h:${huella}`;
  }
  if (clavePadre !== null) {
    if (clavePadre === "") throw new Error("La clave de la línea padre de un adicional no puede estar vacía.");
    return `${clave}|a:${clavePadre}`;
  }
  return clave;
}
