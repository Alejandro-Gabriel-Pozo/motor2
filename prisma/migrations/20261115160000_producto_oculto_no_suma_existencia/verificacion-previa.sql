-- Verificación de 20261115160000_producto_oculto_no_suma_existencia (solo lectura). Correr ANTES y DESPUÉS de aplicar, en cada base, y guardar la salida.
-- ANTES: la función y el disparador no existen. DESPUÉS: existen, el disparador es BEFORE INSERT FOR EACH ROW sobre "MovimientoStock", la función es SECURITY DEFINER; y hoy NO hay marcas ocultas con las que el disparador
-- pudiera rechazar algo (cuántas marcas ocultas hay, por si se aplica sobre una base que ya las usa: ver también cuántos productos ocultos tienen saldo distinto de cero).
SELECT to_regprocedure('rechazar_suma_a_producto_oculto()')::text AS funcion;
SELECT tgname::text AS disparador, pg_get_triggerdef(oid) AS definicion FROM pg_trigger WHERE tgrelid = to_regclass('public."MovimientoStock"') AND tgname = 'MovimientoStock_producto_oculto_trg';
SELECT proname::text, prosecdef AS security_definer, proconfig FROM pg_proc WHERE proname = 'rechazar_suma_a_producto_oculto';
SELECT count(*) AS marcas_ocultas FROM "OcultamientoProducto" WHERE "oculto";
SELECT o."productoId", o."sucursalId", count(*) AS secciones_con_saldo
  FROM "OcultamientoProducto" o
  JOIN (SELECT m."productoId", m."seccionId", s."sucursalId", sum(m."cantidad") AS saldo FROM "MovimientoStock" m JOIN "Seccion" s ON s."id" = m."seccionId" GROUP BY 1, 2, 3 HAVING sum(m."cantidad") <> 0) x
    ON x."productoId" = o."productoId" AND (o."sucursalId" IS NULL OR o."sucursalId" = x."sucursalId")
 WHERE o."oculto" GROUP BY 1, 2;
