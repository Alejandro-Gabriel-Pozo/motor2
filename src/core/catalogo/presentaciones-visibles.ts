/**
 * INTERRUPTOR de las PRESENTACIONES de compra (decisión del dueño, 2026-11-06: «falta ocultar las presentaciones»; el envase de compra pasa a vivir en el vínculo proveedor × materia prima,
 * Q3 opción C confirmada el 2026-11-03, `docs/diseno-envase-de-compra-en-el-vinculo-2026-11-03.md` §1.3 y etapa E2). Una sola constante, el mismo patrón que `DESCUENTO_POR_PRODUCTO_VISIBLE`.
 * Con `false`:
 *  - el formulario de edición del producto no ofrece la gestión de presentaciones y la ficha del producto no lista las «Presentaciones de compra»;
 *  - la pantalla de Compra no ofrece elegir una presentación (ni la Compra por pasos, ni la precarga del proveedor): `listarPresentaciones`, `obtenerDatosDeCompraDelProducto` y la carga
 *    de productos del proveedor para el carrito devuelven la lista vacía;
 *  - el servidor rechaza crear, reactivar con otro factor, activar o desactivar una presentación (`agregarPresentacionAlternativa`, `actualizarActivaPresentacion`), aunque el pedido se arme a mano.
 * No se borra nada ni se toca la base: las presentaciones que ya existían quedan como están. Una línea de compra que ya trae el id de una presentación sigue resolviéndose igual en el servidor
 * (`cargarPresentacionActiva`): no se cambia en silencio cuánto stock entra con una cantidad ya tecleada (stock y costo no se tocan con este interruptor).
 * Para volver a encenderlo: poner `true` (nada más). Lo comprueba `test/catalogo/presentaciones-interruptor.test.ts` (los dos estados).
 */
export const PRESENTACIONES_VISIBLES: boolean = false;

/** Lo que responde el servidor a un pedido que escribe una presentación con el interruptor apagado. */
export const MENSAJE_PRESENTACIONES_APAGADAS = "Las presentaciones de compra están apagadas por ahora: no se pueden crear ni cambiar.";
