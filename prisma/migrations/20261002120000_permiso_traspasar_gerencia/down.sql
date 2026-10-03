-- Reversa de la migración 20261002120000_permiso_traspasar_gerencia. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261002120000_permiso_traspasar_gerencia/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'traspasar_gerencia';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'traspasar_gerencia';
DELETE FROM "Accion" WHERE "clave" = 'traspasar_gerencia';
