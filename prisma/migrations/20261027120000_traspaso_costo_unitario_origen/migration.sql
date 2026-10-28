-- E2 «EL COSTO VIAJA CON EL TRASPASO» (ADR-040, docs/diseno-costo-en-el-traspaso-2026-10-27.md; columna AUTORIZADA por el dueño el 2026-10-27; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en una base real,
-- base por base, con respaldo y ensayo en una rama de Neon): NO APLICADA en ninguna base real.
-- `TraspasoSucursal.costoUnitarioOrigen`: la COPIA del costo de reposición del origen (por unidad de stock) en el instante del envío. La escribe el origen UNA vez, en la misma transacción SERIALIZABLE que la
-- salida y el traspaso ENVIADO; la entrada del destino y el reingreso usan esta copia (nunca el costo del origen de ese momento). Misma precisión que `MovimientoStock.precioPorUnidadStock` (DECIMAL(14,4)): la
-- copia es exacta. NULL = el origen no tenía costo conocido («pendiente de completar»; nunca se inventa 0). CHECK: nunca negativa.
-- ADITIVA y SIN RELLENO: los traspasos existentes quedan en NULL (sus líneas siguen en 0, que los lectores excluyen con `> 0`); sin default (solo cambia el catálogo). El código anterior no lee ni escribe la
-- columna. Sin índice (no se busca por costo), sin políticas de RLS (la de `TraspasoSucursal` es por fila: ENTRE_SUCURSALES) y sin GRANT nuevos (`motor2_app` tiene privilegios de TABLA, que cubren la columna).
-- ORDEN DE DESPLIEGUE: esta migración va ANTES que el código (el código nuevo escribe la columna: sin ella el envío falla).
-- Reversa: down.sql (a mano, como dueño; ABORTA si ya hay costos copiados; después marcarla revertida en `_prisma_migrations`: ver el pie de down.sql).

ALTER TABLE "TraspasoSucursal" ADD COLUMN "costoUnitarioOrigen" DECIMAL(14,4);
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_costo_unitario_origen_no_negativo_chk" CHECK ("costoUnitarioOrigen" IS NULL OR "costoUnitarioOrigen" >= 0);
