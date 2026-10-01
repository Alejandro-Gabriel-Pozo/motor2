-- Reversa de la migración 20261001150000_particion_permisos_carta. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001150000_particion_permisos_carta/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Borra las claves nuevas y todo lo configurado sobre ellas desde la migración (los padres quedaron intactos en la fase expandir).

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN (
  'carta_ver',
  'carta_secciones',
  'carta_generos',
  'carta_contenido_producto',
  'carta_items_agrupados',
  'carta_portal',
  'carta_promos',
  'carta_tema'
);
DELETE FROM "PermisoRol" WHERE "accionClave" IN (
  'carta_ver',
  'carta_secciones',
  'carta_generos',
  'carta_contenido_producto',
  'carta_items_agrupados',
  'carta_portal',
  'carta_promos',
  'carta_tema'
);
DELETE FROM "Accion" WHERE "clave" IN (
  'carta_ver',
  'carta_secciones',
  'carta_generos',
  'carta_contenido_producto',
  'carta_items_agrupados',
  'carta_portal',
  'carta_promos',
  'carta_tema'
);

