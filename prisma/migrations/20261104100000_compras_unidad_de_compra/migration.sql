-- Compras, etapa 2a (docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §6 fila 2a, §14.1 y §14.2; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo): la UNIDAD DE COMPRA y LO COMPRADO
-- de cada línea de compra. Dos columnas nulables en `FacturaProveedorRenglon` (renglón de la factura repartida) y en `MovimientoStock` (compra simple): `unidadCompraId` (la unidad en que se compró: caja, kg...) y `cantidadCompra` (cuántas).
-- NULL = «pendiente de completar» (compras anteriores a esta migración): nunca se inventa. Solo las escribe una COMPRA; no cambia stock, costo ni Kardex.
--
-- REGLAS EN LA BASE: las dos columnas van juntas (CHECK `..._unidad_compra_pareo_chk`: o están las dos o ninguna) y la cantidad es mayor que cero (CHECK `..._cantidad_compra_chk`); la unidad es de la MISMA empresa
-- (clave foránea compuesta (empresaId, unidadCompraId) → Unidad(empresaId, id), RESTRICT: una unidad usada en una compra no se borra). Sin índices nuevos (el reporte filtra por proveedor, fecha y producto, que ya tienen índice). No cambia la RLS ni los GRANT
-- (la app ya tiene SELECT e INSERT sobre las dos tablas, a nivel tabla).
--
-- ADITIVA y REVERSIBLE: el código anterior no lee ni escribe nada de esto. `ADD COLUMN` nulable sin DEFAULT no reescribe la tabla (solo toma ACCESS EXCLUSIVE un instante); los CHECK y la FK se agregan sobre columnas que nacen en NULL, así que se cumplen
-- para todo lo existente. Aplicar con `SET lock_timeout = '5s'` en la conexión del dueño (precedente M-9).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después marcarla revertida en `_prisma_migrations`). ABORTA si ya hay líneas con unidad de compra cargada.

ALTER TABLE "FacturaProveedorRenglon"
  ADD COLUMN "unidadCompraId" TEXT,
  ADD COLUMN "cantidadCompra" DECIMAL(14,4);

ALTER TABLE "MovimientoStock"
  ADD COLUMN "unidadCompraId" TEXT,
  ADD COLUMN "cantidadCompra" DECIMAL(14,4);

ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_empresaId_unidadCompraId_fkey"
  FOREIGN KEY ("empresaId", "unidadCompraId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_unidadCompraId_fkey"
  FOREIGN KEY ("empresaId", "unidadCompraId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_unidad_compra_pareo_chk" CHECK (("unidadCompraId" IS NULL) = ("cantidadCompra" IS NULL));
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_cantidad_compra_chk" CHECK ("cantidadCompra" IS NULL OR "cantidadCompra" > 0);
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_unidad_compra_pareo_chk" CHECK (("unidadCompraId" IS NULL) = ("cantidadCompra" IS NULL));
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_cantidad_compra_chk" CHECK ("cantidadCompra" IS NULL OR "cantidadCompra" > 0);
