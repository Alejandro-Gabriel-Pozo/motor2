-- Reversa de 20261002150500_permiso_carta_copiar_de_sucursal. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261002150500_permiso_carta_copiar_de_sucursal/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'carta_copiar_de_sucursal';
DELETE FROM "PermisoRol" WHERE "accionClave" = 'carta_copiar_de_sucursal';
DELETE FROM "Accion" WHERE "clave" = 'carta_copiar_de_sucursal';
