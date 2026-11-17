-- Reversa de 20261117120200_compras_permiso_controlar_recepcion (Compras N3-b). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117120200_compras_permiso_controlar_recepcion/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117120200_compras_permiso_controlar_recepcion`.
-- ABORTA, sin tocar nada, si alguien configuró algo a mano sobre la clave (una capacidad por sucursal, una fila de un rol que no es de la semilla, o una de la semilla con Ver o Editar apagado). Con solo la semilla borra las
-- filas de `PermisoRol` y de `Accion`. IMPORTANTE: revertir el CÓDIGO de N3-b antes (o a la vez). Idempotente.
DO $$
DECLARE
  hay bigint;
BEGIN
  SELECT (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'compra_controlar_recepcion')
       + (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
          WHERE p."accionClave" = 'compra_controlar_recepcion'
            AND (NOT p."puedeVer" OR NOT p."puedeEditar" OR r."clave" IS NULL OR r."clave" NOT IN ('admin', 'operador')))
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117120200_compras_permiso_controlar_recepcion: hay % fila(s) de configuración de la clave hecha a mano. Resguardalas y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" = 'compra_controlar_recepcion';
DELETE FROM "Accion" WHERE "clave" = 'compra_controlar_recepcion';
