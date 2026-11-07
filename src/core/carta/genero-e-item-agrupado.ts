/**
 * INTERRUPTOR de «Género de carta» e «Ítem agrupado» (decisión del dueño, 2026-11-06: «ocultá género e ítem agrupado»): hoy NO SE VEN. Una sola constante para los dos
 * (el mismo patrón que `MENU_DEL_DIA_VISIBLE`, `menu-del-dia.ts`, y `DESCUENTO_POR_PRODUCTO_VISIBLE`, `descuento-producto.ts`).
 *
 * UNA sola y no una por concepto: comparten flujo. El ítem agrupado hereda el género (`ItemAgrupadoCarta.generoCartaId`, sus opciones «nunca tienen uno propio»), el género
 * existe para ubicar productos sueltos E ítems agrupados en la misma carpeta del POS, y el formulario del producto y la pantalla de agrupados ofrecen el género en el mismo lugar.
 * Prender uno sin el otro dejaría géneros que solo agrupan productos sueltos, que no es lo que se aprobó.
 *
 * NECESIDAD (quién y dónde está escrita): el dueño, 2026-11-06 — `GeneroCarta` e `ItemAgrupadoCarta` resuelven el mismo problema que las OPCIONES de venta (agrupar, ordenar y dar
 * variantes de un producto en la carta; «las marcas se resuelven con opciones»). En producción hay 0 ítems agrupados y géneros sin productos (según el dueño: Agua, Agua saborizada, Huinganco): no hay datos que
 * perder. Documento de reglas esperadas: `docs/oraculo-combinaciones-poda-genero-agrupado-2026-11-06.md`.
 *
 * Con `false`:
 *  - el servidor rechaza, con `MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO`, todas las escrituras de géneros e ítems agrupados (alta, edición, apagar, sumar/quitar/reordenar opciones),
 *    la asignación de un género a un producto y «aplicar el mismo precio» a los hermanos de un ítem agrupado, aunque el pedido se arme a mano (después del permiso, que sigue siendo lo primero);
 *  - la carta pública, el selector del POS y las lecturas que ubican productos en la carta IGNORAN esa estructura: un producto que fuera opción de un ítem agrupado sale suelto en su sección (si tiene
 *    contenido visible), el ítem agrupado no se arma y el POS no agrupa por género (la lista plana de la sección);
 *  - (etapa 2, pantallas) las pantallas de administración, sus entradas de menú y los permisos `carta_generos` / `carta_items_agrupados` en la matriz.
 * No se borra nada ni se toca la base: las tablas, las filas y las claves de permiso quedan como están, y se vuelven a leer al encender.
 * Para volver a encenderlo: poner `true` (nada más). El retiro definitivo es una etapa aparte que exige autorización expresa del dueño.
 */
export const GENERO_E_ITEM_AGRUPADO_VISIBLE: boolean = false;

/** Lo que responde el servidor a una escritura de géneros o ítems agrupados con el interruptor apagado. */
export const MENSAJE_GENERO_E_ITEM_AGRUPADO_APAGADO = "Los géneros y los ítems agrupados de la carta están apagados por ahora: se resuelven con las opciones de venta.";
