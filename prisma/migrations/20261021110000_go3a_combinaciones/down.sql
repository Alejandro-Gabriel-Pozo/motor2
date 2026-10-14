-- Reversa de 20261021110000_go3a_combinaciones (GO-3a). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si hay filas en cualquiera de las seis tablas (grupos de precio, combinaciones, precios locales, recetas de combinación
-- con sus ingredientes y fotos de la venta), algún eje de combinación declarado en `ProductoAdmiteGrupo`, o si la configuración de la clave `grupos_de_precio_definir` ya no es la semilla. Esos datos no se borran en silencio.
-- Sin nada de eso (o si ya no existen), saca todo con IF EXISTS: las seis tablas, la clave, el índice parcial, el CHECK y la columna `ejeDeCombinacion`.
-- Bajar esta DESPUÉS de GO-3a-rls (las políticas de sucursal dependen de las tablas). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada), fuera del horario de servicio
-- (`SET lock_timeout = '5s'`: borrar la foto toca la clave foránea de `CuentaItem`); después `npx prisma migrate resolve --rolled-back 20261021110000_go3a_combinaciones`. Idempotente. Después de desplegar las funciones de GO-3 no se baja: se usa Instant Rollback.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GrupoDePrecio', 'CombinacionDeProducto', 'PrecioLocalDeCombinacion', 'RecetaDeCombinacionVersion', 'RecetaDeCombinacionIngrediente', 'CombinacionEnLinea'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      hay := hay + n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND column_name = 'ejeDeCombinacion') THEN
    EXECUTE 'SELECT count(*) FROM "ProductoAdmiteGrupo" WHERE "ejeDeCombinacion" IS NOT NULL' INTO n;
    hay := hay + n;
  END IF;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-3a: hay % fila(s) de combinaciones (grupos de precio, combinaciones, precios locales, recetas de combinación, fotos de la venta o ejes declarados). Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" = 'grupos_de_precio_definir' AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'grupos_de_precio_definir')
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-3a: hay % fila(s) de configuración de la clave grupos_de_precio_definir que no puso la migración (delegaciones, cambios del admin o capacidades por sucursal). Guardalas (SELECT * FROM "PermisoRol" WHERE "accionClave" = ''grupos_de_precio_definir'') y decidí antes cómo seguir.', n;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" = 'grupos_de_precio_definir';
DELETE FROM "Accion" WHERE "clave" = 'grupos_de_precio_definir';

DROP TABLE IF EXISTS "CombinacionEnLinea";
DROP TABLE IF EXISTS "RecetaDeCombinacionIngrediente";
DROP TABLE IF EXISTS "RecetaDeCombinacionVersion";
DROP TABLE IF EXISTS "PrecioLocalDeCombinacion";
DROP TABLE IF EXISTS "CombinacionDeProducto";
DROP TABLE IF EXISTS "GrupoDePrecio";

DROP INDEX IF EXISTS "ProductoAdmiteGrupo_un_grupo_por_eje_key";
ALTER TABLE "ProductoAdmiteGrupo" DROP CONSTRAINT IF EXISTS "ProductoAdmiteGrupo_eje_de_combinacion_chk";
ALTER TABLE "ProductoAdmiteGrupo" DROP COLUMN IF EXISTS "ejeDeCombinacion";
