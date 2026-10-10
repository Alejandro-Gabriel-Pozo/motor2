-- Reversa del alta de `producto_campos_sensibles` (M.2, P1). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261013120000_permiso_producto_campos_sensibles/down.sql
-- y después `prisma migrate resolve --rolled-back 20261013120000_permiso_producto_campos_sensibles`.
-- Borra la clave y todo lo configurado sobre ella desde la migración. El orden respeta las claves foráneas (CapacidadSucursal y PermisoRol apuntan a Accion).
-- IMPORTANTE: revertir el CÓDIGO de P2 a P5 antes (o a la vez): con el código nuevo y la clave borrada, nadie podría cambiar un precio, un factor ni una unidad.

DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'producto_campos_sensibles';

DELETE FROM "PermisoRol" WHERE "accionClave" = 'producto_campos_sensibles';

DELETE FROM "Accion" WHERE "clave" = 'producto_campos_sensibles';
