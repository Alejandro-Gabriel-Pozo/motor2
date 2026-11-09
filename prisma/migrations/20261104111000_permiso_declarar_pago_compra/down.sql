-- Reversa del alta de la clave `declarar_pago_compra` (Pagos X0). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261104111000_permiso_declarar_pago_compra/down.sql
-- y después `prisma migrate resolve --rolled-back 20261104111000_permiso_declarar_pago_compra`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre la clave (una capacidad por sucursal, o una fila de un rol que no es `admin`, o una del admin con Ver o Editar apagado). Si lo único que hay es la semilla de
-- la migración (el rol `admin` de cada empresa, con Ver y Editar), borra las filas de `PermisoRol` y de `Accion` en ese orden. Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" = 'declarar_pago_compra'; SELECT * FROM "CapacidadSucursal" WHERE "accionClave" = 'declarar_pago_compra';
-- IMPORTANTE: revertir el CÓDIGO de X0 antes (o a la vez): con el código nuevo y la clave borrada, nadie podría declarar un pago. Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'declarar_pago_compra')
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" = 'declarar_pago_compra'
            AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261104111000_permiso_declarar_pago_compra: hay % fila(s) de configuración de la clave hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" = 'declarar_pago_compra';
DELETE FROM "Accion" WHERE "clave" = 'declarar_pago_compra';
