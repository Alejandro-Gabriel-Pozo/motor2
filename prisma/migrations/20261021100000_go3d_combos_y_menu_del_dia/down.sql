-- Reversa de 20261021100000_go3d_combos_y_menu_del_dia (GO-3d). NO destructiva: ABORTA, sin tocar nada (`RAISE EXCEPTION`), si hay algo que solo pudo escribir el código de GO-3: una entrada de cupo o una opción de entrada,
-- un plato del día, un cupo LISTA o DEL_DIA, con nombre o dado de baja, una promo con vigencia o días de semana, o si la configuración de la clave `promo_menu_del_dia` ya no es la semilla (una delegación, un cambio del admin o una
-- capacidad por sucursal). Esos datos no se borran en silencio. Sin nada de eso (o si ya no existen), saca todo con IF EXISTS: las tres tablas, los CHECK, el índice parcial, las columnas nuevas y la clave; y `seccionCartaId` vuelve a NOT NULL.
-- Bajar esta DESPUÉS de GO-3d-rls (las políticas de sucursal del plato del día dependen de la tabla). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada), sin tráfico de la
-- administración de la carta (`SET lock_timeout = '5s'`); después `npx prisma migrate resolve --rolled-back 20261021100000_go3d_combos_y_menu_del_dia`. Idempotente. Después de desplegar las funciones de GO-3 no se baja: se usa Instant Rollback.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EntradaDeCupo', 'OpcionDeEntradaDeCupo', 'EntradaDelDiaDeCupo'] LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      hay := hay + n;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCartaCupo' AND column_name = 'tipo')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCartaCupo' AND column_name = 'nombre')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCartaCupo' AND column_name = 'activo') THEN
    EXECUTE 'SELECT count(*) FROM "PromoCartaCupo" WHERE "tipo" <> ''SECCION'' OR "nombre" IS NOT NULL OR NOT "activo" OR "seccionCartaId" IS NULL' INTO n;
    hay := hay + n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCarta' AND column_name = 'diasDeSemana') THEN
    EXECUTE 'SELECT count(*) FROM "PromoCarta" WHERE "vigenteDesde" IS NOT NULL OR "vigenteHasta" IS NOT NULL OR "diasDeSemana" IS NOT NULL' INTO n;
    hay := hay + n;
  END IF;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-3d: hay % fila(s) de combos o menú del día (entradas, platos del día, cupos de tipo nuevo o dados de baja, promos con vigencia). Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
  SELECT (SELECT count(*) FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId"
           WHERE p."accionClave" = 'promo_menu_del_dia' AND (r."clave" IS DISTINCT FROM 'admin' OR NOT p."puedeVer" OR NOT p."puedeEditar"))
       + (SELECT count(*) FROM "CapacidadSucursal" WHERE "accionClave" = 'promo_menu_del_dia')
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-3d: hay % fila(s) de configuración de la clave promo_menu_del_dia que no puso la migración (delegaciones, cambios del admin o capacidades por sucursal). Guardalas (SELECT * FROM "PermisoRol" WHERE "accionClave" = ''promo_menu_del_dia'') y decidí antes cómo seguir.', n;
  END IF;
END
$$;

DELETE FROM "PermisoRol" WHERE "accionClave" = 'promo_menu_del_dia';
DELETE FROM "Accion" WHERE "clave" = 'promo_menu_del_dia';

DROP TABLE IF EXISTS "EntradaDelDiaDeCupo";
DROP TABLE IF EXISTS "OpcionDeEntradaDeCupo";
DROP TABLE IF EXISTS "EntradaDeCupo";

DROP INDEX IF EXISTS "PromoCartaCupo_nombre_lower_key";
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_nombre_chk";
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_seccion_solo_en_seccion_chk";
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT IF EXISTS "PromoCartaCupo_tipo_chk";
ALTER TABLE "PromoCartaCupo" ALTER COLUMN "seccionCartaId" SET NOT NULL;
ALTER TABLE "PromoCartaCupo" DROP COLUMN IF EXISTS "activo", DROP COLUMN IF EXISTS "nombre", DROP COLUMN IF EXISTS "tipo";

ALTER TABLE "PromoCarta" DROP CONSTRAINT IF EXISTS "PromoCarta_vigencia_chk";
ALTER TABLE "PromoCarta" DROP CONSTRAINT IF EXISTS "PromoCarta_dias_de_semana_chk";
ALTER TABLE "PromoCarta" DROP COLUMN IF EXISTS "diasDeSemana", DROP COLUMN IF EXISTS "vigenteHasta", DROP COLUMN IF EXISTS "vigenteDesde";
