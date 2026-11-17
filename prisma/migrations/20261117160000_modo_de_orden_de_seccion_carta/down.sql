-- Reversa de 20261117160000_modo_de_orden_de_seccion_carta (Carta, orden de renglones O1). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117160000_modo_de_orden_de_seccion_carta`.
-- Bajar ANTES 20261117160100_rls_sucursal_modo_de_orden_de_seccion_carta (sus políticas cuelgan de la tabla; DROP TABLE las arrastra, pero la reversa de esa migración es la que deja el registro limpio).
-- ABORTA si hay filas: se perderían los modos de orden elegidos (la auditoría los conserva, pero no se podría reconstruir el estado). Con la tabla vacía el estado resultante es el de antes: todas las secciones a mano, como hoy.
-- Bajarla dos veces no falla: si la tabla ya no está, no hay nada que contar.
DO $$
DECLARE
  modos bigint;
BEGIN
  modos := 0;
  IF to_regclass('"ModoDeOrdenDeSeccionCarta"') IS NOT NULL THEN SELECT count(*) INTO modos FROM "ModoDeOrdenDeSeccionCarta"; END IF;
  IF modos > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117160000_modo_de_orden_de_seccion_carta: hay % modo(s) de orden cargados', modos;
  END IF;
END
$$;

DROP TABLE IF EXISTS "ModoDeOrdenDeSeccionCarta";
