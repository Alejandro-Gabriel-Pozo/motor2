-- Reversa de 20261019103000_permisos_centros_de_costos (Paquete 5, M7.4). NO destructiva sobre lo configurado: ABORTA, sin tocar nada, si la configuración de las tres claves ya no es la semilla de la migración
-- (alguna fila de PermisoRol de otro rol que no sea `admin`, o del admin con Ver o Editar apagados, o alguna CapacidadSucursal sobre estas claves): esos datos no se borran en silencio. Con la semilla pura borra las filas de PermisoRol y las tres claves de Accion.
-- Es más estricta que la reversa de M4.5 (que era destructiva) a propósito. Se baja PRIMERO de M7 (orden: M7.4, M7.3, M7.2, M7.1). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`
-- (UNA transacción); después `npx prisma migrate resolve --rolled-back 20261019103000_permisos_centros_de_costos`. Idempotente.

DO $$
DECLARE
  ajenas integer;
BEGIN
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" IN ('centros_costos', 'distribucion_costos', 'reporte_gastos_por_unidad')
             AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('centros_costos', 'distribucion_costos', 'reporte_gastos_por_unidad'))
  INTO ajenas;
  IF ajenas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar M7.4: hay % fila(s) de configuración de las claves de centros de costos que no puso la migración (delegaciones, cambios del admin o capacidades por sucursal). Guardalas (SELECT * FROM "PermisoRol" WHERE "accionClave" IN (''centros_costos'', ''distribucion_costos'', ''reporte_gastos_por_unidad'')) y decidí antes cómo seguir.', ajenas;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" IN ('centros_costos', 'distribucion_costos', 'reporte_gastos_por_unidad');
DELETE FROM "Accion" WHERE "clave" IN ('centros_costos', 'distribucion_costos', 'reporte_gastos_por_unidad');
