-- Reversa de 20261018100000_nota_credito_proveedor (Paquete 4, M6.1). NO es destructiva: ABORTA, sin tocar nada, si alguna de las cuatro tablas tiene filas (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si están vacías (o no existen), las borra y quita los dos índices únicos de destino que agregó a las tablas de M3.
-- Bajar ANTES M6.2 (las políticas de la imputación). Orden de la reversa de todo el Paquete 4: M6.4, M6.3, M6.2, M6.1, M5, M4.5, M4.4, M4.3, M4.2 y M4.1. Con M6.1 arriba FALLAN, enteras y a propósito, las reversas de M4.2 (el índice de naturaleza lo usa la clave foránea de la línea), de M4.1 y de M3b.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261018100000_nota_credito_proveedor`. Si Prisma responde «not in a failed state», se borra la fila de `_prisma_migrations` (docs/deploy-con-migraciones.md). Idempotente.

DO $$
DECLARE
  t text;
  hay bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['NotaCreditoProveedorImputacion', 'NotaCreditoProveedorTributo', 'NotaCreditoProveedorLinea', 'NotaCreditoProveedor'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO hay;
      IF hay > 0 THEN
        RAISE EXCEPTION 'No se puede bajar M6.1: la tabla % tiene % fila(s). Resguardalas (pg_dump) y decidí antes cómo seguir.', t, hay;
      END IF;
    END IF;
  END LOOP;
END
$$;

DROP TABLE IF EXISTS "NotaCreditoProveedorImputacion";
DROP TABLE IF EXISTS "NotaCreditoProveedorTributo";
DROP TABLE IF EXISTS "NotaCreditoProveedorLinea";
DROP TABLE IF EXISTS "NotaCreditoProveedor";
DROP INDEX IF EXISTS "FacturaProveedorRenglon_empresaId_facturaProveedorId_id_key";
DROP INDEX IF EXISTS "FacturaProveedor_empresaId_id_proveedorId_key";
