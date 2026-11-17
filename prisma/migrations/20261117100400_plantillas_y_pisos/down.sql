-- Reversa de 20261117100400_plantillas_y_pisos (roles propios, EB-1). NO la corre Prisma: se aplica a mano como DUEÑO de las tablas y en UNA transacción (`-1`):
--   psql -1 "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261117100400_plantillas_y_pisos/down.sql
-- y después `prisma migrate resolve --rolled-back 20261117100400_plantillas_y_pisos`.
-- ABORTA, sin tocar nada, si la plataforma ya hizo algo a mano: más de tres plantillas, una versión de número mayor que 1 o que no sea de la migración, un piso cambiado (versión mayor que 1), de otro autor o en otra cantidad
-- que los de la semilla, o más acciones introducidas que las de la semilla. Si solo está la semilla, borra las 4 tablas y las funciones. Antes de bajarla con datos a mano, guardar
--   SELECT * FROM "PlantillaDeRol"; SELECT * FROM "VersionDePlantilla"; SELECT * FROM "PisoDePlataforma"; SELECT * FROM "AccionIntroducida";
-- Las cuentas de la semilla (3 plantillas, 14 pisos, 140 acciones introducidas) las saca el generador del catálogo y un test las compara con estos literales: si el catálogo cambia, se actualizan acá antes de aplicar.
-- IMPORTANTE: revertir el CÓDIGO de EB-1 antes (o a la vez). Idempotente.

DO $$
DECLARE
  hay bigint;
BEGIN
  IF to_regclass('"PisoDePlataforma"') IS NULL THEN
    RETURN;
  END IF;
  SELECT abs((SELECT count(*) FROM "PlantillaDeRol") - 3)
       + (SELECT count(*) FROM "VersionDePlantilla" WHERE "numero" > 1 OR "autor" <> 'migracion:plantillas_y_pisos')
       + (SELECT count(*) FROM "PisoDePlataforma" WHERE "version" > 1 OR "autor" <> 'migracion:plantillas_y_pisos')
       + abs((SELECT count(*) FROM "PisoDePlataforma") - 14)
       + greatest((SELECT count(*) FROM "AccionIntroducida") - 140, 0)
    INTO hay;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117100400_plantillas_y_pisos: hay % fila(s) de plantillas/pisos cargadas a mano: resguardalas y decidí antes.', hay;
  END IF;
END
$$;

DROP TABLE IF EXISTS "VersionDePlantilla";
DROP TABLE IF EXISTS "PlantillaDeRol";
DROP TABLE IF EXISTS "PisoDePlataforma";
DROP TABLE IF EXISTS "AccionIntroducida";
DROP FUNCTION IF EXISTS alta_de_version_de_plantilla();
DROP FUNCTION IF EXISTS cambio_de_piso_de_plataforma();
DROP FUNCTION IF EXISTS incumplimiento_de_pisos(text, text[]);
DROP FUNCTION IF EXISTS solo_se_agrega_plantillas_y_pisos();
DROP FUNCTION IF EXISTS proteger_plantillas_y_pisos();
DROP FUNCTION IF EXISTS claves_de_accion_validas(text[]);
DROP FUNCTION IF EXISTS clave_de_accion_valida(text);
