-- Reversa del alta de `compra_repartir` (Paquete 3, M3a). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`: o se borran las tres cosas o ninguna):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261016100000_permiso_compra_repartir/down.sql
-- y después `prisma migrate resolve --rolled-back 20261016100000_permiso_compra_repartir`.
-- DESTRUCTIVA: borra la clave y todo lo configurado sobre ella desde la migración (qué roles la tenían y la capacidad por sucursal). Antes de bajarla, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" = 'compra_repartir';
-- El orden respeta las claves foráneas (CapacidadSucursal y PermisoRol apuntan a Accion). Bajar DESPUÉS las demás de M3 (M3d, M3c, M3b): esta es la primera que se subió, la última que se baja.
-- IMPORTANTE: revertir el CÓDIGO de la Etapa C antes (o a la vez): con el código nuevo y la clave borrada, nadie podría repartir una factura.

DELETE FROM "CapacidadSucursal" WHERE "accionClave" = 'compra_repartir';

DELETE FROM "PermisoRol" WHERE "accionClave" = 'compra_repartir';

DELETE FROM "Accion" WHERE "clave" = 'compra_repartir';
