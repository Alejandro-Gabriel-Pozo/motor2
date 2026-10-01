-- Reversa de la migración 20261001170000_particion_permisos_producto. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001170000_particion_permisos_producto/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra las claves nuevas y todo lo configurado sobre ellas desde la migración (el padre quedó intacto en la fase expandir).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN (
  'producto_editar',
  'producto_asignar_insumo',
  'producto_sincronizar_precio_carta'
);
DELETE FROM "PermisoRol" WHERE "accionClave" IN (
  'producto_editar',
  'producto_asignar_insumo',
  'producto_sincronizar_precio_carta'
);
DELETE FROM "Accion" WHERE "clave" IN (
  'producto_editar',
  'producto_asignar_insumo',
  'producto_sincronizar_precio_carta'
);
