-- Reversa de 20261020130000_go1d_linea_con_opciones (GO-1d). NO destructiva: ABORTA, sin tocar nada, si hay alguna foto en `OpcionElegidaEnLinea`, alguna línea con huella o con línea padre, o alguna operación con operación padre (`RAISE EXCEPTION`): esos datos no se borran en silencio.
-- Sin datos (o si ya no existen las tablas o columnas), saca todo con IF EXISTS: los tres disparadores y sus funciones, la tabla de la foto, los CHECK, las claves foráneas, los índices y las columnas.
-- Bajar esta DESPUÉS de GO-1d-rls (sus políticas de sucursal dependen de la tabla) y ANTES que GO-1b (el catálogo que la foto referencia). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada), sin tráfico del POS
-- (`SET lock_timeout = '5s'`); después `npx prisma migrate resolve --rolled-back 20261020130000_go1d_linea_con_opciones`. Idempotente.
-- Después de desplegar GO-2 no se baja: se usa Instant Rollback.

DO $$
DECLARE
  hay bigint := 0;
  n bigint;
BEGIN
  IF to_regclass('"OpcionElegidaEnLinea"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "OpcionElegidaEnLinea"' INTO n;
    hay := hay + n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CuentaItem' AND column_name = 'lineaPadreId')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CuentaItem' AND column_name = 'huellaOpciones') THEN
    EXECUTE 'SELECT count(*) FROM "CuentaItem" WHERE "huellaOpciones" IS NOT NULL OR "lineaPadreId" IS NOT NULL' INTO n;
    hay := hay + n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Operacion' AND column_name = 'operacionPadreId') THEN
    EXECUTE 'SELECT count(*) FROM "Operacion" WHERE "operacionPadreId" IS NOT NULL' INTO n;
    hay := hay + n;
  END IF;
  IF hay > 0 THEN
    RAISE EXCEPTION 'No se puede bajar GO-1d: hay % línea(s) vendidas con opciones, adicionales o fotos. Resguardalas (pg_dump) y decidí antes cómo seguir.', hay;
  END IF;
END
$$;

DROP TABLE IF EXISTS "OpcionElegidaEnLinea";
DROP FUNCTION IF EXISTS "OpcionElegidaEnLinea_coherente_con_su_linea"();
DROP TRIGGER IF EXISTS "Operacion_padre_inmutable_chk" ON "Operacion";
DROP FUNCTION IF EXISTS "Operacion_padre_inmutable"();
DROP TRIGGER IF EXISTS "CuentaItem_opciones_chk" ON "CuentaItem";
DROP FUNCTION IF EXISTS "CuentaItem_reglas_de_opciones"();
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_padre_solo_venta_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_operacionPadreId_fkey";
DROP INDEX IF EXISTS "Operacion_operacionPadreId_idx";
ALTER TABLE "Operacion" DROP COLUMN IF EXISTS "operacionPadreId";
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_adicional_chk";
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_huella_opciones_chk";
ALTER TABLE "CuentaItem" DROP CONSTRAINT IF EXISTS "CuentaItem_empresaId_lineaPadreId_fkey";
DROP INDEX IF EXISTS "CuentaItem_lineaPadreId_idx";
ALTER TABLE "CuentaItem" DROP COLUMN IF EXISTS "lineaPadreId", DROP COLUMN IF EXISTS "huellaOpciones";
