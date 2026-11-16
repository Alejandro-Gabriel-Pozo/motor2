-- Reversa de 20261117110000_caja_c1 (Caja y cobro, etapa C1). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117110000_caja_c1`.
-- Bajar ANTES 20261117111000_rls_sucursal_caja_c1 (sus políticas cuelgan de las tablas; DROP TABLE las arrastra, pero la reversa de esa migración es la que deja el registro limpio).
-- ABORTA si hay filas en CUALQUIERA de las ocho tablas: se perderían movimientos de dinero (la auditoría los nombra, pero no se podría reconstruir la caja). Con las tablas vacías el estado resultante es el de antes: sin caja.
-- Bajarla dos veces no falla: si una tabla ya no está, no hay nada que contar.
DO $$
DECLARE
  t text;
  filas bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['ArqueoBillete', 'ArqueoCaja', 'Cobro', 'Cobranza', 'MovimientoCaja', 'SesionCaja', 'MedioDePago', 'Caja'] LOOP
    filas := 0;
    IF to_regclass(format('%I', t)) IS NOT NULL THEN EXECUTE format('SELECT count(*) FROM %I', t) INTO filas; END IF;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117110000_caja_c1: la tabla % tiene % fila(s)', t, filas;
    END IF;
  END LOOP;
END
$$;

DROP TABLE IF EXISTS "ArqueoBillete";
DROP TABLE IF EXISTS "ArqueoCaja";
DROP TABLE IF EXISTS "Cobro";
DROP TABLE IF EXISTS "Cobranza";
DROP TABLE IF EXISTS "MovimientoCaja";
DROP TABLE IF EXISTS "SesionCaja";
DROP TABLE IF EXISTS "MedioDePago";
DROP TABLE IF EXISTS "Caja";
DROP FUNCTION IF EXISTS "SesionCaja_verificar_cierre"();
DROP FUNCTION IF EXISTS "Arqueo_validar"();
DROP FUNCTION IF EXISTS "Cobranza_cuadra"();
DROP FUNCTION IF EXISTS "Cobro_validar"();
DROP FUNCTION IF EXISTS "Cobranza_validar"();
DROP FUNCTION IF EXISTS "MovimientoCaja_validar"();
DROP FUNCTION IF EXISTS "SesionCaja_exigir_abierta"(text, uuid, text);
DROP FUNCTION IF EXISTS "SesionCaja_validar"();
