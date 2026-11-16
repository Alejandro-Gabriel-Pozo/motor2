-- Reversa de 20261117130200_compras_permisos_orden_de_compra (Compras, etapa OC). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117130200_compras_permisos_orden_de_compra/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117130200_compras_permisos_orden_de_compra`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre las claves (una capacidad por sucursal, una fila de un rol que no es de la semilla, o una de la semilla con Ver o Editar apagado). Con solo la semilla borra las filas
-- de `PermisoRol` y de `Accion`. IMPORTANTE: revertir el CÓDIGO de la etapa OC antes (o a la vez). Idempotente.
DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" IN ('orden_de_compra_gestionar', 'compras_configurar')
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS NULL OR r."clave" <> 'admin'))
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" = 'orden_de_compra_ver'
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS NULL OR r."clave" NOT IN ('admin', 'operador')))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117130200_compras_permisos_orden_de_compra: hay % fila(s) de configuración de las claves hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver');
DELETE FROM "Accion" WHERE "clave" IN ('orden_de_compra_gestionar', 'compras_configurar', 'orden_de_compra_ver');
