-- Reversa de 20261117118000_permisos_caja_c1 (Caja y cobro, C1, PR-B). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117118000_permisos_caja_c1/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117118000_permisos_caja_c1`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las claves (una capacidad por sucursal, una fila de un rol que no es la semilla, o una de la semilla con Ver o Editar apagado). Si lo único que hay es la semilla
-- de la migración, borra las filas de `PermisoRol` y de `Accion`. Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" IN ('caja_ver','caja_abrir_sesion','caja_cerrar_sesion','caja_mover_efectivo','caja_anular_movimiento_ajeno','cobrar_cuenta');
--   SELECT * FROM "CapacidadSucursal" WHERE "accionClave" IN (…las mismas seis…);
-- IMPORTANTE: revertir el CÓDIGO de C1 PR-B antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('caja_ver', 'caja_abrir_sesion', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_anular_movimiento_ajeno', 'cobrar_cuenta'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" IN ('caja_ver', 'caja_abrir_sesion', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_anular_movimiento_ajeno', 'cobrar_cuenta')
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS DISTINCT FROM 'admin'))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117118000_permisos_caja_c1: hay % fila(s) de configuración de las claves hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('caja_ver', 'caja_abrir_sesion', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_anular_movimiento_ajeno', 'cobrar_cuenta');
DELETE FROM "Accion" WHERE "clave" IN ('caja_ver', 'caja_abrir_sesion', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_anular_movimiento_ajeno', 'cobrar_cuenta');
