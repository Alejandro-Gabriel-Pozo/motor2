-- Reversa de la migración 20261007120000_accion_renombrar_rol. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261007120000_accion_renombrar_rol/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra la clave nueva y todo lo configurado sobre ella desde la migración (`gestion_roles` quedó intacta).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'renombrar_rol';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'renombrar_rol';
DELETE FROM "Accion" WHERE "clave" = 'renombrar_rol';
