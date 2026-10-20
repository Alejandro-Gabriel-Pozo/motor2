-- RETIRO DE GO-3a, esquema (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon; por ahora SOLO la base de producción): ola «precio y carta», Fase 3,
-- paso 3.7 (ADR-032, «Fase 3: retiro de GO-3a»; decisiones del dueño DEC-02 y DEC-16). BORRA lo que agregó 20261021110000_go3a_combinaciones: las seis tablas de las combinaciones (GrupoDePrecio,
-- CombinacionDeProducto, PrecioLocalDeCombinacion, RecetaDeCombinacionVersion, RecetaDeCombinacionIngrediente y CombinacionEnLinea), la columna ProductoAdmiteGrupo.ejeDeCombinacion con su CHECK y su
-- índice único parcial, y la clave de permiso `grupos_de_precio_definir` (sus filas en `PermisoRol` y en `Accion`: SON DATOS, una fila por empresa con rol admin, que puso la migración de GO-3a).
--
-- NO BORRA NINGÚN DATO DE NEGOCIO: lo primero es un bloque que ABORTA (RAISE EXCEPTION, sin tocar nada) si hay UNA sola fila en cualquiera de las seis tablas, algún eje declarado, o si la
-- configuración de la clave ya no es la semilla (otro rol la tiene, el admin sin Ver o sin Editar, o una capacidad por sucursal). Es el mismo criterio que el down.sql de GO-3a. En producción GO-3a
-- tiene 0 filas, 0 ventas con combinación y ningún eje: la verificación previa de SOLO LECTURA es scripts/operaciones/verificar-retiro-go3a.sql (correrla antes de pedir el OK).
--
-- Requiere: 20261022100000_retiro_go3a_rls aplicada (saca las políticas de sucursal de dos de estas tablas) y el código de la Fase 3 (>= paso 3.5) desplegado y verificado: el código anterior pide la
-- columna en la lectura de las opciones de toda venta y de la carta, y el anterior a 3.4 lee la foto al cerrar. Después de aplicarla, Instant Rollback SOLO a despliegues >= 3.5.
-- AL APLICAR: borrar CombinacionEnLinea suelta su clave foránea hacia `CuentaItem` (bloqueo breve sobre `CuentaItem`) y `ProductoAdmiteGrupo` toma ACCESS EXCLUSIVE hasta el COMMIT (tabla chica):
-- con `SET lock_timeout = '5s'` y FUERA DEL HORARIO DE SERVICIO. Los permisos de las tablas y el de la columna caen con ellas.
-- Reversa: down.sql (vuelve a crear todo VACÍO, con el mismo SQL de GO-3a), a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` y borrar su fila de `_prisma_migrations` (`DELETE FROM _prisma_migrations WHERE migration_name = '20261022101000_retiro_go3a'`;
-- `prisma migrate resolve --rolled-back` responde P3012 sobre una migración ya aplicada); después, el down.sql de 20261022100000_retiro_go3a_rls.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GrupoDePrecio', 'CombinacionDeProducto', 'PrecioLocalDeCombinacion', 'RecetaDeCombinacionVersion', 'RecetaDeCombinacionIngrediente', 'CombinacionEnLinea'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    hay := hay + n;
  END LOOP;
  SELECT count(*) INTO n FROM "ProductoAdmiteGrupo" WHERE "ejeDeCombinacion" IS NOT NULL;
  hay := hay + n;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede retirar GO-3a: hay % fila(s) de combinaciones (grupos de precio, combinaciones, precios locales, recetas de combinación, fotos de la venta o ejes declarados). Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" = 'grupos_de_precio_definir' AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'grupos_de_precio_definir')
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'No se puede retirar GO-3a: hay % fila(s) de configuración de la clave grupos_de_precio_definir que no puso la migración de GO-3a (delegaciones, cambios del admin o capacidades por sucursal). Guardalas (SELECT * FROM "PermisoRol" WHERE "accionClave" = ''grupos_de_precio_definir'') y decidí antes cómo seguir.', n;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" = 'grupos_de_precio_definir';
DELETE FROM "Accion" WHERE "clave" = 'grupos_de_precio_definir';

DROP TABLE "CombinacionEnLinea";
DROP TABLE "RecetaDeCombinacionIngrediente";
DROP TABLE "RecetaDeCombinacionVersion";
DROP TABLE "PrecioLocalDeCombinacion";
DROP TABLE "CombinacionDeProducto";
DROP TABLE "GrupoDePrecio";

DROP INDEX "ProductoAdmiteGrupo_un_grupo_por_eje_key";
ALTER TABLE "ProductoAdmiteGrupo" DROP CONSTRAINT "ProductoAdmiteGrupo_eje_de_combinacion_chk";
ALTER TABLE "ProductoAdmiteGrupo" DROP COLUMN "ejeDeCombinacion";
