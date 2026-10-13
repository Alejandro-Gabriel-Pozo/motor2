-- Reversa de 20261017100000_reclasificacion_renglon (Paquete 4, M5). NO destructiva: ABORTA, sin tocar nada, si ya hay reclasificaciones (`RAISE EXCEPTION`); esos datos no se borran en silencio. Si la tabla está vacía (o no existe), la borra.
-- Bajar esta ANTES que cualquier down de M4: con esta subida, el down de M4.2 falla en el `DROP INDEX` del discriminador y el de M4.1 en el `DROP TABLE "ConceptoDeGasto"` (dependencias, a propósito). Orden de la reversa: M5, M4.5, M4.4, M4.3, M4.2 y M4.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261017100000_reclasificacion_renglon`. Idempotente.

DO $$
DECLARE
  hay integer;
BEGIN
  IF to_regclass('"ReclasificacionRenglon"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "ReclasificacionRenglon"' INTO hay;
    IF hay > 0 THEN
      RAISE EXCEPTION 'No se puede bajar M5: hay % reclasificación(es) de renglones sin stock. Resguardalas (pg_dump -t ''"ReclasificacionRenglon"'') y decidí antes cómo seguir.', hay;
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS "ReclasificacionRenglon";
