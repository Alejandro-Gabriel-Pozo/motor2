-- Reversa de la migración 20261002140000_permisos_receta_sucursal. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261002140000_permisos_receta_sucursal/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN ('receta_sucursal_editar', 'receta_sucursal_copiar', 'receta_sucursal_volver_central');
DELETE FROM "PermisoRol" WHERE "accionClave" IN ('receta_sucursal_editar', 'receta_sucursal_copiar', 'receta_sucursal_volver_central');
DELETE FROM "Accion" WHERE "clave" IN ('receta_sucursal_editar', 'receta_sucursal_copiar', 'receta_sucursal_volver_central');
