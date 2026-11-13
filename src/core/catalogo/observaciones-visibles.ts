/**
 * INTERRUPTOR del campo «Observaciones» del producto (dueño, 2026-11-13: «Ocultarlo con interruptor reversible»; Pedernal no lo muestra). Una sola constante, el mismo patrón que `PRESENTACIONES_VISIBLES`
 * y `DESCUENTO_POR_PRODUCTO_VISIBLE`. Con `false`:
 *  - la ficha del producto (la pestaña Datos) y el alta no muestran el campo ni su valor;
 *  - nada más cambia: el dato sigue en la base (no se borra ni se toca), guardar la ficha no lo pisa (un campo ausente no se escribe) y «Duplicar» lo sigue copiando (`SE_COPIA`).
 * Para volver a mostrarlo: poner `true` (nada más). Lo comprueban `test/catalogo/observaciones-interruptor.test.tsx` (los dos estados, con el valor guardado).
 */
export const OBSERVACIONES_VISIBLES: boolean = false;
