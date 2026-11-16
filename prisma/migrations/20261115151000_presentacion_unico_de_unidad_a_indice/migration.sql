-- «RELAJAR EL ÚNICO (producto, unidad) DE LA PRESENTACIÓN» (etapa C1, a2-1; docs/diseno-productos-igual-a-pedernal-2026-11-13.md §9; decisión del dueño 2026-11-13: «El de Pedernal: presentación por producto (Recomendada)» —«caja x6» y «caja x12» son dos
-- presentaciones del mismo producto, con nombres distintos y la misma unidad «caja»— y 2026-11-15: «Y mientras las autorizaciones tengan down.sql, vamos…»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo en copia):
-- el índice ÚNICO "Presentacion_productoId_unidadCompraId_key" pasa a índice COMÚN "Presentacion_productoId_unidadCompraId_idx" (se mantiene para las lecturas por producto y unidad). La unicidad que manda ahora es la del nombre
-- ("Presentacion_empresaId_productoId_nombre_lower_key", etapa a).
-- ATENCIÓN: la línea de compra todavía identifica la presentación SOLO por la unidad (Movimiento.unidadCompraId → `cargarPresentacionActiva`). Hasta que la línea apunte a la presentación (etapa d, con diseño aparte), dos presentaciones ACTIVAS del mismo producto
-- con la misma unidad hacen que la compra con esa unidad se RECHACE (fallo cerrado en `cargarPresentacionActiva`: ni stock ni costo se mueven) y que el alta las rechace. Hoy no puede haber ninguna: PRESENTACIONES_VISIBLES está apagado y nada escribe presentaciones.
-- ADITIVA en datos: no toca ninguna fila; solo relaja una restricción. El código anterior sigue funcionando (nunca dependió de que el único exista para leer; las altas por (producto, unidad) las protege ahora el bloqueo de la fila del producto).
-- Reversa: down.sql (a mano, como dueño). SE FRENA sin tocar nada si ya hay dos presentaciones del mismo producto con la misma unidad.

DROP INDEX "Presentacion_productoId_unidadCompraId_key";
CREATE INDEX "Presentacion_productoId_unidadCompraId_idx" ON "Presentacion" ("productoId", "unidadCompraId");
