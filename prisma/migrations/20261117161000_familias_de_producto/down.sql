-- Reversa de 20261117161000_familias_de_producto (Carta, familias F1). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117161000_familias_de_producto`.
-- ABORTA si hay filas en cualquiera de las dos tablas: se perderían las familias y sus miembros (la auditoría las conserva, pero no se podría reconstruir el estado). Con las tablas vacías el estado resultante es el de antes (sin familias).
-- Saca también el disparador que esta migración le puso a `OpcionItemAgrupadoCarta` (el invariante transitorio vuelve a no existir; el ítem agrupado queda como estaba). Bajarla dos veces no falla.
DO $$
DECLARE
  familias bigint;
  miembros bigint;
BEGIN
  familias := 0;
  miembros := 0;
  IF to_regclass('"FamiliaDeProducto"') IS NOT NULL THEN SELECT count(*) INTO familias FROM "FamiliaDeProducto"; END IF;
  IF to_regclass('"MiembroDeFamilia"') IS NOT NULL THEN SELECT count(*) INTO miembros FROM "MiembroDeFamilia"; END IF;
  IF familias > 0 OR miembros > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117161000_familias_de_producto: hay % familia(s) y % miembro(s) cargados', familias, miembros;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS "OpcionItemAgrupadoCarta_no_si_en_familia" ON "OpcionItemAgrupadoCarta";
DROP FUNCTION IF EXISTS "OpcionItemAgrupadoCarta_no_si_en_familia"();
DROP TABLE IF EXISTS "MiembroDeFamilia";
DROP TABLE IF EXISTS "FamiliaDeProducto";
DROP FUNCTION IF EXISTS "MiembroDeFamilia_no_si_agrupado"();
DROP FUNCTION IF EXISTS "MiembroDeFamilia_proteger"();
DROP FUNCTION IF EXISTS "FamiliaDeProducto_proteger"();
