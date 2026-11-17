/**
 * INTERRUPTOR de las AYUDAS permanentes de la ficha del producto (Frente 6, pantallas; decisión del dueño, 2026-11-16: «Sí, ese orden (Recomendada)», paso 2 «textos de la ficha del producto»; criterio: «las pantallas
 * de pedernal, son con menos datos y más justas», y en la maqueta aprobada de Pedernal la ficha casi no tiene ayudas: 10 palabras en Datos, 0 en Precios y 0 en Opciones). Una sola constante, el mismo patrón que
 * `OBSERVACIONES_VISIBLES`. Con `false` (hoy) NO se dibujan los textos de abajo; con `true` vuelven tal cual (nada más: no cambia el servidor, ni lo guardado, ni los permisos).
 *
 * TEXTOS QUE SE OCULTAN (declarados, uno por uno; solo las AYUDAS siempre visibles; las ETIQUETAS, los BOTONES y los AVISOS condicionales —permisos, lo que falta, advertencias de precio, confirmaciones— se quedan):
 *  Datos (`producto-form.tsx`):
 *   1. «El tipo no se puede cambiar una vez creado el producto — recetas, ventas y stock ya asumen cuál es…» (edición).
 *   2. «Agrupa esta materia prima con otras que sean, en la práctica, la misma…» (materia prima).
 *   3. La ayuda de las unidades: «Stock: en qué unidad se mide el inventario…» (materia prima) / «En qué unidad se mide el inventario de este producto…» (producto de venta).
 *   4. «Cuántas unidades de stock entran en 1 unidad de compra — ej. 25 si comprás bolsas de 25kg…» (factor de conversión).
 *   5. «Dejalo vacío para vender siempre de a una unidad entera (lo habitual)…» (paso de venta).
 *   6. En el alta: «Tildado (lo habitual…): queda disponible en las N sucursales…» / «Sin tildar: solo queda disponible en «X»…» (activo en todas las sucursales).
 *   7. «El producto queda en tu depósito pero sigue siendo propiedad del proveedor hasta que se vende…» (es consignación).
 *   8. «Lo que le pagás al proveedor por cada unidad vendida…» (precio de consignación).
 *  Opciones (`opciones/page.tsx`, `admision-de-grupo.tsx`, `vista-previa-de-la-carta.tsx`):
 *   9. «Qué se elige al venderlo y cómo cambia el precio. El precio del producto está en la pestaña Precios. Los grupos y sus opciones se arman en la Biblioteca de opciones.» (OJO: con ese párrafo sale también el
 *      ENLACE a la Biblioteca de opciones; sigue en el menú Catálogo › Biblioteca de opciones).
 *  10. «No se borra nada: lo que admite de cada opción queda guardado.» (junto a «Quitar de este producto», en cada grupo).
 *  11. La ayuda de «Mostrar este grupo en la carta»: «Si lo destildás, la carta (en pantalla y en papel) no lo muestra en este producto…».
 *  12. «Con el precio de lista de «S», sin descuentos. Es la forma que le da la carta pública; si cambia algo arriba, se actualiza al guardar.» (bajo «Cómo se va a ver en la carta»).
 * Precios no cambia (sus textos son datos o avisos de precio).
 *
 * Lo comprueba `test/catalogo/ficha-ayudas-interruptor.test.tsx` (los dos estados). Para volver a mostrarlas: poner `true`.
 */
export const FICHA_AYUDAS_VISIBLES: boolean = false;
