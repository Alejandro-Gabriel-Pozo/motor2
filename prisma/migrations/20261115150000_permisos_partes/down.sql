-- Reversa de 20261115150000_permisos_partes (Parte, P1 (b)). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261115150000_permisos_partes/down.sql
-- y después `prisma migrate resolve --rolled-back 20261115150000_permisos_partes`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las claves (una capacidad por sucursal, una fila de un rol que no es la semilla, o una de la semilla con Ver o Editar apagado). Si lo único que hay es la semilla
-- de la migración, borra las filas de `PermisoRol` y de `Accion`. Antes de bajarla con configuración a mano, guardar
--   SELECT * FROM "PermisoRol" WHERE "accionClave" LIKE 'partes\_%'; SELECT * FROM "CapacidadSucursal" WHERE "accionClave" LIKE 'partes\_%';
-- IMPORTANTE: revertir el CÓDIGO de P1 (b) antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('partes_ver', 'partes_editar', 'partes_desactivar'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" IN ('partes_ver', 'partes_editar', 'partes_desactivar')
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS DISTINCT FROM 'admin'))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261115150000_permisos_partes: hay % fila(s) de configuración de las claves hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('partes_ver', 'partes_editar', 'partes_desactivar');
DELETE FROM "Accion" WHERE "clave" IN ('partes_ver', 'partes_editar', 'partes_desactivar');
