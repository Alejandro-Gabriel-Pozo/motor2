-- Verificación previa de 20261117118100_caja_c3b_una_cuenta_por_sucursal (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real).
-- Esperado: C3 aplicada (existe CuentaDeCobro), el índice nuevo NO existe todavía y NINGUNA sucursal tiene más de una cuenta de cobro activa. Si alguna tiene, el bloque final ABORTA con el detalle (empresa, sucursal y cuántas):
-- desactivar las sobrantes (dejar la que el dueño elija) y volver a correr.
SELECT 'tabla_de_c3_presente' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CuentaDeCobro'; -- 1
SELECT 'indice_nuevo_que_ya_existe' AS control, count(*) AS cantidad FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'CuentaDeCobro_una_activa_por_sucursal_key'; -- 0
SELECT 'sucursales_con_mas_de_una_cuenta_activa' AS control, "empresaId", "sucursalId", count(*) AS activas FROM "CuentaDeCobro" WHERE "activa" GROUP BY "empresaId", "sucursalId" HAVING count(*) > 1; -- 0 filas
DO $$
DECLARE n bigint; detalle text;
BEGIN
  SELECT count(*), string_agg(t."empresaId" || '/' || t."sucursalId" || ' (' || t.activas || ' activas)', ', ') INTO n, detalle
    FROM (SELECT "empresaId", "sucursalId", count(*) AS activas FROM "CuentaDeCobro" WHERE "activa" GROUP BY "empresaId", "sucursalId" HAVING count(*) > 1) t;
  IF n > 0 THEN
    RAISE EXCEPTION 'No se puede aplicar 20261117118100_caja_c3b_una_cuenta_por_sucursal: % sucursal(es) con más de una cuenta de cobro activa: %. Desactivar las sobrantes y volver a correr.', n, detalle;
  END IF;
END
$$;
