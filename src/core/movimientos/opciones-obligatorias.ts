import { validarOpcionesElegidas, type GrupoPermitido } from "@/core/opciones/public";

/**
 * UN PRODUCTO CON OPCIONES OBLIGATORIAS NO SE VENDE SIN ELEGIRLAS (hueco de la venta de mostrador, ADR-030 «Venta»; fila O.430 de `docs/pureza-integracion.md`). Un producto que admite un grupo
 * con mínimo mayor que 0 (el tamaño que fija el precio y el consumo de stock) se cobra con SU configuración: una línea que llega sin ella —la venta de mostrador, que no tiene selector de
 * opciones— cobraría el precio base como si nada. En el POS ya lo impide el agregado de ítems (`validarOpcionesElegidas`: `GRUPO_MINIMO_NO_ALCANZADO`); esta es la BARRERA FINAL del núcleo de la venta
 * (`armarLinea`, `registrar-venta-en-tx.ts`), para toda vía que venda una línea SIN configurar.
 *
 * Puro (P0): sin lectura ni escritura, solo el criterio y el texto. NO reimplementa la regla de los grupos: llama a `validarOpcionesElegidas` con CERO opciones elegidas, que es exactamente lo que
 * hace el POS con «un cliente viejo que no manda opciones» — el mínimo efectivo (el del producto si lo sobrescribe), el grupo desasignado (no cuenta) y el obligatorio apagado (falla cerrado: vender sin elegir
 * lo obligatorio cobraría mal). Sin ninguna opción elegida, lo único que esa validación puede rechazar es un grupo obligatorio.
 */

/** El código tipado del rechazo (`fracaso`): lo devuelven la venta de mostrador y el cierre de cuenta. */
export const CODIGO_PRODUCTO_REQUIERE_OPCIONES = "PRODUCTO_REQUIERE_OPCIONES" as const;

/** El mensaje del rechazo: nombra el producto y dice dónde se vende. */
export function mensajeProductoRequiereOpciones(nombre: string): string {
  return `«${nombre}» se vende con opciones obligatorias (ej. tamaño): cobralo desde las mesas/POS, donde se eligen.`;
}

/** Por qué una línea SIN configurar de este producto NO se puede vender (el mensaje), o `null` si no tiene ningún grupo obligatorio. `grupos`: lo que el producto admite en la sucursal que vende. */
export function rechazoPorOpcionesObligatorias(nombre: string, grupos: readonly GrupoPermitido[]): string | null {
  return validarOpcionesElegidas(grupos, []).ok ? null : mensajeProductoRequiereOpciones(nombre);
}
