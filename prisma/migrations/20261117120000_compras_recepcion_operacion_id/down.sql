-- Reversa de 20261117120000_compras_recepcion_operacion_id. NO destructiva: solo quita el permiso de UPDATE de la columna `operacionId` de la parte de la factura (los datos no se tocan; una parte ya confirmada conserva su compra).
-- Antes de bajar, volver primero el código (Instant Rollback) y apagar el módulo `recepcion_de_compras` en las empresas que lo tengan: con la columna sin permiso, confirmar una recepción falla (cierra, no abre).
-- Bases locales y de CI: el rol de los fixtures de test copia los privilegios de `motor2_app` y no se nombra en `prisma/` (lo prohíbe `test/arquitectura/rol-de-pruebas-solo-local.test.ts`): después de bajar, se pone al día con `scripts/operaciones/crear-rol-motor2-app.sql` (ver el encabezado de ese script).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261117120000_compras_recepcion_operacion_id`. Idempotente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE UPDATE ("operacionId") ON "FacturaProveedorSucursal" FROM motor2_app;
  END IF;
END
$$;
