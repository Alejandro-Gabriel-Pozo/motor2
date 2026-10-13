-- Reversa de 20261020100000_go1a_permisos_de_opciones (GO-1a). NO destructiva sobre lo configurado: ABORTA, sin tocar nada, si la configuración de las tres claves ya no es la semilla de la migración
-- (alguna fila de PermisoRol de otro rol que no sea `admin`, o del admin con Ver o Editar apagados, o alguna CapacidadSucursal sobre estas claves): esos datos no se borran en silencio. Con la semilla pura borra las filas de PermisoRol y las tres claves de Accion.
-- Se baja ÚLTIMA de GO-1 (orden de reversa: GO-1d-rls, GO-1d, GO-1c-rls, GO-1c, GO-1b, GO-1a). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`
-- (UNA transacción); después `npx prisma migrate resolve --rolled-back 20261020100000_go1a_permisos_de_opciones`. Idempotente.

DO $$
DECLARE
  ajenas integer;
BEGIN
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" IN ('opciones_definir', 'producto_opciones_admitidas', 'opcion_apagar_en_sucursal')
             AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('opciones_definir', 'producto_opciones_admitidas', 'opcion_apagar_en_sucursal'))
  INTO ajenas;
  IF ajenas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-1a: hay % fila(s) de configuración de las claves de opciones que no puso la migración (delegaciones, cambios del admin o capacidades por sucursal). Guardalas (SELECT * FROM "PermisoRol" WHERE "accionClave" IN (''opciones_definir'', ''producto_opciones_admitidas'', ''opcion_apagar_en_sucursal'')) y decidí antes cómo seguir.', ajenas;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('opciones_definir', 'producto_opciones_admitidas', 'opcion_apagar_en_sucursal');
DELETE FROM "Accion" WHERE "clave" IN ('opciones_definir', 'producto_opciones_admitidas', 'opcion_apagar_en_sucursal');
