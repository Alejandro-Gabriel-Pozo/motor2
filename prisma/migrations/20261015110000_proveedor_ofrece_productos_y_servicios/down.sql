-- Reversa de 20261015110000_proveedor_ofrece_productos_y_servicios (M1, clasificación del proveedor). Idempotente (IF EXISTS).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261015110000_proveedor_ofrece_productos_y_servicios`.
--
-- AVISO, DESTRUCTIVA SEGÚN CUÁNDO:
--   1. Mientras nadie escriba las columnas (antes de que la pantalla de proveedores las edite), NO destruye nada: todas las filas tienen el default (true, false).
--   2. Desde que se puede clasificar a un proveedor, SÍ destruye la clasificación. ANTES de correrla, guardar lo que se pierde:
--        SELECT "id", "empresaId", "ofreceProductos", "ofreceServicios" FROM "Proveedor" WHERE NOT ("ofreceProductos" AND NOT "ofreceServicios");
--   3. PRIMERO se vuelve el código (Instant Rollback del deploy) y DESPUÉS se corre esta reversa: con las columnas borradas, el cliente Prisma nuevo falla en todo
--      lectura de la fila entera de "Proveedor" (alta, edición, pago a consignante).

ALTER TABLE "Proveedor" DROP CONSTRAINT IF EXISTS "Proveedor_ofrece_productos_o_servicios_chk";
ALTER TABLE "Proveedor" DROP COLUMN IF EXISTS "ofreceServicios";
ALTER TABLE "Proveedor" DROP COLUMN IF EXISTS "ofreceProductos";
