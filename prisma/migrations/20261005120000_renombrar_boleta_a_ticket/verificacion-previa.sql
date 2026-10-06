-- Verificación previa de 20261005120000_renombrar_boleta_a_ticket (solo lectura). Correr ANTES de aplicar, en cada base, y guardar la salida.
-- Esperado: la tabla vieja existe y la nueva no; los 10 objetos con el nombre viejo; ninguna fila con la clave nueva todavía.
SELECT to_regclass('public."EjemplarBoleta"')::text AS tabla_vieja, to_regclass('public."EjemplarTicket"')::text AS tabla_nueva;
SELECT conname::text AS objeto FROM pg_constraint WHERE conrelid = to_regclass('public."EjemplarBoleta"') ORDER BY 1;
SELECT indexname::text AS objeto FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'EjemplarBoleta' ORDER BY 1;
SELECT count(*) AS ejemplares FROM "EjemplarBoleta";
SELECT 'Accion' AS tabla, "clave"::text AS clave, count(*) FROM "Accion" WHERE "clave" IN ('reporte_boletas','reporte_tickets','pos_emitir_boleta_corregida','pos_emitir_ticket_corregido') GROUP BY 2
UNION ALL SELECT 'PermisoRol', "accionClave"::text, count(*) FROM "PermisoRol" WHERE "accionClave" IN ('reporte_boletas','reporte_tickets','pos_emitir_boleta_corregida','pos_emitir_ticket_corregido') GROUP BY 2
UNION ALL SELECT 'CapacidadSucursal', "accionClave"::text, count(*) FROM "CapacidadSucursal" WHERE "accionClave" IN ('reporte_boletas','reporte_tickets','pos_emitir_boleta_corregida','pos_emitir_ticket_corregido') GROUP BY 2
ORDER BY 1, 2;
