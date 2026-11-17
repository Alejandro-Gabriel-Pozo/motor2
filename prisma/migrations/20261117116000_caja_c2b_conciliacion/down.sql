-- Reversa de 20261117116000_caja_c2b_conciliacion (Caja y cobro, etapa C2b). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117116000_caja_c2b_conciliacion`.
-- Bajar ANTES 20261117117000_rls_sucursal_caja_c2b (sus políticas cuelgan de las tablas; DROP TABLE las arrastra, pero la reversa de esa migración es la que deja el registro limpio).
-- ABORTA si hay filas en CUALQUIERA de las tres tablas: son la foto congelada de un día cerrado y no se podría reconstruir (el total vigente del ticket de ese momento no se guarda en ningún otro lado). Con las tablas vacías el estado resultante es el de C2.
-- Bajarla dos veces no falla: si una tabla ya no está, no hay nada que contar ni que borrar.
DO $$
DECLARE
  t text;
  filas bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['ConciliacionDeCobroPorOrigen', 'ConciliacionDeJornada', 'CierreDeCajaDeJornada'] LOOP
    filas := 0;
    IF to_regclass(format('%I', t)) IS NOT NULL THEN EXECUTE format('SELECT count(*) FROM %I', t) INTO filas; END IF;
    IF filas > 0 THEN
      RAISE EXCEPTION 'No se puede bajar 20261117116000_caja_c2b_conciliacion: la tabla % tiene % fila(s)', t, filas;
    END IF;
  END LOOP;
END
$$;

DROP TABLE IF EXISTS "ConciliacionDeCobroPorOrigen";
DROP TABLE IF EXISTS "ConciliacionDeJornada";
DROP TABLE IF EXISTS "CierreDeCajaDeJornada";
DROP FUNCTION IF EXISTS "CierreDeCajaDeJornada_verificar"();
DROP FUNCTION IF EXISTS "ConciliacionDeCobroPorOrigen_validar"();
DROP FUNCTION IF EXISTS "ConciliacionDeJornada_validar"();
DROP FUNCTION IF EXISTS "CierreDeCajaDeJornada_validar"();
