-- Reversa de 20261117120100_compras_control_de_linea_de_recepcion (Compras N3-b). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `prisma migrate resolve --rolled-back 20261117120100_compras_control_de_linea_de_recepcion`.
-- ABORTA si hay filas: se perderían los controles registrados (la auditoría no guarda su detalle). Con la tabla vacía el estado resultante es el de antes. Antes de bajar, volver el código y apagar el módulo `recepcion_de_compras`. Idempotente.
DO $$
DECLARE
  controles bigint;
BEGIN
  controles := 0;
  IF to_regclass('public."ControlDeLineaDeRecepcion"') IS NOT NULL THEN SELECT count(*) INTO controles FROM public."ControlDeLineaDeRecepcion"; END IF;
  IF controles > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117120100_compras_control_de_linea_de_recepcion: hay % control(es) de línea registrados', controles;
  END IF;
END
$$;

DROP TABLE IF EXISTS "ControlDeLineaDeRecepcion";
DROP FUNCTION IF EXISTS compras_control_de_linea_validar();
