-- Verificación de 20261117120000_compras_recepcion_operacion_id (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: UPDATE de `motor2_app` sobre FacturaProveedorSucursal solo en estadoRecepcion, recibidaEn y recibidaPorId. DESPUÉS: además operacionId (y nada más).
SELECT column_name::text AS columna, grantee::text AS rol, privilege_type
  FROM information_schema.column_privileges
  WHERE table_schema = 'public' AND table_name = 'FacturaProveedorSucursal' AND grantee = 'motor2_app' AND privilege_type = 'UPDATE' ORDER BY 1;
-- Las políticas de la tabla (idénticas antes y después):
SELECT policyname::text, permissive, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'FacturaProveedorSucursal' ORDER BY 1;
-- La unicidad (empresaId, operacionId) sigue:
SELECT indexname::text FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'FacturaProveedorSucursal' AND indexname = 'FacturaProveedorSucursal_empresaId_operacionId_key';
-- Partes pendientes hoy (deben ser 0 antes de encender el módulo en una empresa):
SELECT count(*) AS partes_pendientes FROM "FacturaProveedorSucursal" WHERE "estadoRecepcion" = 'PENDIENTE';
