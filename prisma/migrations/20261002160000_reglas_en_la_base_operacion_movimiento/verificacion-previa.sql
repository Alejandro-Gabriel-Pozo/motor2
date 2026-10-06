-- Verificación previa de 20261002160000_reglas_en_la_base_operacion_movimiento. SOLO LEE (un SELECT).
-- Se corre con el rol dueño (el que migra) en CADA base (zuluhub, stockhneuquen) ANTES de aprobar la migración:
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261002160000_reglas_en_la_base_operacion_movimiento/verificacion-previa.sql
-- Cada fila es una regla; `fuera_de_regla` tiene que ser 0 en todas. Si alguna da más de 0, la migración fallaría en ESA base (el VALIDATE
-- revertiría todo): no se aprueba hasta decidir qué hacer con esas filas (corregirlas o sacar esa regla de la migración).

SELECT regla, fuera_de_regla FROM (
  SELECT 'MovimientoStock_signo_por_proceso_chk' AS regla, count(*) AS fuera_de_regla FROM "MovimientoStock"
   WHERE NOT (
     (proceso IN ('COMPRA', 'PRODUCCION', 'DEVOLUCION_CLIENTE', 'TRANSFERENCIA_ENTRADA_SUCURSAL', 'REINGRESO_TRANSFERENCIA_SUCURSAL') AND cantidad >= 0)
     OR (proceso IN ('CONSUMO', 'MERMA', 'VENTA', 'DEVOLUCION_CONSIGNACION', 'DEVOLUCION_PROVEEDOR', 'TRANSFERENCIA_SALIDA_SUCURSAL') AND cantidad <= 0)
     OR (proceso = 'LIQUIDACION_CONSIGNACION' AND cantidad = 0)
     OR proceso IN ('AJUSTE', 'CONTROL', 'TRANSFERENCIA', 'RECLASIFICACION')
   )
  UNION ALL
  SELECT 'MovimientoStock_precios_no_negativos_chk', count(*) FROM "MovimientoStock"
   WHERE NOT ("precioPorUnidadStock" >= 0 AND ("precioTotal" >= 0 OR proceso IN ('AJUSTE', 'LIQUIDACION_CONSIGNACION')))
  UNION ALL
  SELECT 'MovimientoStock_cantidad_exacta_signo_chk', count(*) FROM "MovimientoStock"
   WHERE "cantidadExacta" IS NOT NULL AND cantidad * "cantidadExacta" < 0
  UNION ALL
  SELECT 'MovimientoStock_campos_de_venta_chk', count(*) FROM "MovimientoStock"
   WHERE NOT (
     ("costoUnitarioVenta" IS NULL OR (proceso = 'VENTA' AND "costoUnitarioVenta" >= 0))
     AND ("precioListaUnitario" IS NULL OR (proceso = 'VENTA' AND "precioListaUnitario" >= 0))
   )
  UNION ALL
  SELECT 'MovimientoStock_sustituye_solo_consumo_chk', count(*) FROM "MovimientoStock"
   WHERE "sustituyeAProductoId" IS NOT NULL AND proceso <> 'CONSUMO'
  UNION ALL
  SELECT 'MovimientoStock_traspaso_solo_en_traspasos_chk', count(*) FROM "MovimientoStock"
   WHERE "traspasoSucursalId" IS NOT NULL
     AND proceso NOT IN ('TRANSFERENCIA_SALIDA_SUCURSAL', 'TRANSFERENCIA_ENTRADA_SUCURSAL', 'REINGRESO_TRANSFERENCIA_SUCURSAL')
  UNION ALL
  SELECT 'MovimientoStock_conteo_solo_en_control_chk', count(*) FROM "MovimientoStock"
   WHERE "conteoFisicoId" IS NOT NULL AND proceso <> 'CONTROL'
  UNION ALL
  -- Índice único parcial: cuenta las líneas SOBRANTES (las que repiten el mismo paso del mismo traspaso).
  SELECT 'MovimientoStock_traspaso_paso_unico_key (líneas repetidas)', coalesce(sum(n - 1), 0) FROM (
    SELECT count(*) AS n FROM "MovimientoStock" WHERE "traspasoSucursalId" IS NOT NULL GROUP BY "traspasoSucursalId", proceso HAVING count(*) > 1
  ) repetidos
  UNION ALL
  SELECT 'Operacion_motivo_solo_merma_chk', count(*) FROM "Operacion" WHERE "motivoId" IS NOT NULL AND proceso <> 'MERMA'
  UNION ALL
  SELECT 'Operacion_destino_solo_consumo_chk', count(*) FROM "Operacion" WHERE "destinoId" IS NOT NULL AND proceso <> 'CONSUMO'
  UNION ALL
  SELECT 'Operacion_seccion_destino_solo_transferencia_chk', count(*) FROM "Operacion" WHERE "seccionDestinoId" IS NOT NULL AND proceso <> 'TRANSFERENCIA'
  UNION ALL
  SELECT 'Operacion_transferencia_exige_seccion_destino_chk', count(*) FROM "Operacion" WHERE proceso = 'TRANSFERENCIA' AND "seccionDestinoId" IS NULL
  UNION ALL
  SELECT 'Operacion_anulacion_coherente_chk', count(*) FROM "Operacion"
   WHERE NOT (("anuladaPorId" IS NULL OR "anuladaEn" IS NOT NULL) AND ("anuladaEn" IS NULL OR proceso IN ('VENTA', 'COMPRA')))
) reglas
ORDER BY regla;
