-- Reversa del alta de las siete claves de gastos (Paquete 3, M4.5): `gasto_ver`, `gasto_registrar`, `gasto_anular`, `gasto_reclasificar`, `gasto_repartir`, `conceptos_gasto` y `reporte_gastos_empresa`. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y
-- en UNA transacción (`-1`: o se borran las tres cosas o ninguna):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261016114000_permisos_gastos/down.sql
-- y después `prisma migrate resolve --rolled-back 20261016114000_permisos_gastos`.
-- DESTRUCTIVA: borra las claves y todo lo configurado sobre ellas desde la migración (qué roles las tenían, incluida la delegación de `gasto_repartir`, y la capacidad por sucursal). Antes de bajarla, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" IN ('gasto_ver','gasto_registrar','gasto_anular','gasto_reclasificar','gasto_repartir','conceptos_gasto','reporte_gastos_empresa');
-- El orden respeta las claves foráneas (CapacidadSucursal y PermisoRol apuntan a Accion). Es la ÚLTIMA de M4 que se subió, así que es la PRIMERA que se baja (antes de M4.4, M4.3, M4.2 y M4.1).
-- IMPORTANTE: revertir el CÓDIGO de la Etapa C antes (o a la vez): con el código nuevo y las claves borradas, nadie podría cargar ni ver un gasto. Idempotente.

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN ('gasto_ver', 'gasto_registrar', 'gasto_anular', 'gasto_reclasificar', 'gasto_repartir', 'conceptos_gasto', 'reporte_gastos_empresa');

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('gasto_ver', 'gasto_registrar', 'gasto_anular', 'gasto_reclasificar', 'gasto_repartir', 'conceptos_gasto', 'reporte_gastos_empresa');

DELETE FROM "Accion" WHERE "clave" IN ('gasto_ver', 'gasto_registrar', 'gasto_anular', 'gasto_reclasificar', 'gasto_repartir', 'conceptos_gasto', 'reporte_gastos_empresa');
