-- Tanda 6: reglas de integridad de Operacion y MovimientoStock en la base (CHECK + un índice único parcial).
--
-- POR QUÉ: hasta hoy estas reglas vivían solo en la capa de aplicación (los casos de uso y `armarFilasDeMovimiento`). Un script, una carga
-- manual o un bug futuro podía dejar un Kardex incoherente sin que nada lo frene. Acá se bajan SOLO las reglas que son invariantes
-- reales del modelo: no tienen ninguna excepción en correcciones, anulaciones, conteos, mermas, producción, traspasos, ventas
-- fraccionadas ni consignación (inventario en docs/pendientes-sesion-2026-10-02.md, Tanda 6).
--
-- QUÉ NO SE BAJA (a propósito): `cantidad <> 0` genérico (un CONSUMO puede redondear a 0, la LIQUIDACION_CONSIGNACION es siempre 0 y
-- AJUSTE/CONTROL admiten 0); igualdad entre el proceso de la línea y el de la cabecera (PRODUCCION y VENTA generan líneas CONSUMO y
-- LIQUIDACION hijas); un único conteo por línea (cancelar un conteo escribe una segunda línea con el mismo `conteoFisicoId`); un trigger
-- append-only sobre el Kardex (la migración de auditoría ya lo excluyó: ~40 tests lo simulan con el rol de ejecución); la igualdad de
-- `empresaId` (la FK compuesta ya la garantiza); y el pareo clave/hash/mensaje de idempotencia (`chequearIdempotencia` define un estado
-- "fail closed" §11.3 —clave sin hash o sin mensaje— que su test de propiedades escribe a propósito).
--
-- CÓMO: cada CHECK se agrega `NOT VALID` (toma el lock apenas un instante) y se valida en el mismo script. Si en una base hay filas
-- viejas que la violan, el `VALIDATE` falla y la migración entera se revierte: por eso existe `verificacion-previa.sql`, que cuenta
-- las filas fuera de regla por cada una y que el dueño corre en cada base ANTES de aprobar. El script es idempotente (DROP IF EXISTS +
-- ADD) y `down.sql` lo deshace.

-- ============================================================================================================================
-- MovimientoStock
-- ============================================================================================================================

-- El signo de la línea sale del proceso (tabla `TRANSICIONES.signoStock`): los que suman nunca restan y al revés. La liquidación de
-- consignación no mueve stock (cantidad 0). AJUSTE, CONTROL, TRANSFERENCIA y RECLASIFICACION llevan el signo puesto por el motor o por
-- quien corrige: sin regla. Las reversiones de anulación son AJUSTE (o LIQUIDACION_CONSIGNACION), así que quedan fuera por construcción.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_signo_por_proceso_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_signo_por_proceso_chk" CHECK (
  (proceso IN ('COMPRA', 'PRODUCCION', 'DEVOLUCION_CLIENTE', 'TRANSFERENCIA_ENTRADA_SUCURSAL', 'REINGRESO_TRANSFERENCIA_SUCURSAL') AND cantidad >= 0)
  OR (proceso IN ('CONSUMO', 'MERMA', 'VENTA', 'DEVOLUCION_CONSIGNACION', 'DEVOLUCION_PROVEEDOR', 'TRANSFERENCIA_SALIDA_SUCURSAL') AND cantidad <= 0)
  OR (proceso = 'LIQUIDACION_CONSIGNACION' AND cantidad = 0)
  OR proceso IN ('AJUSTE', 'CONTROL', 'TRANSFERENCIA', 'RECLASIFICACION')
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_signo_por_proceso_chk";

-- Precios: el precio por unidad nunca es negativo (las reversiones lo conservan igual). El importe de línea solo puede ser negativo en
-- las reversiones de anulación (`precioTotal: -l.precioTotal`), que son AJUSTE o LIQUIDACION_CONSIGNACION.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_precios_no_negativos_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_precios_no_negativos_chk" CHECK (
  "precioPorUnidadStock" >= 0
  AND ("precioTotal" >= 0 OR proceso IN ('AJUSTE', 'LIQUIDACION_CONSIGNACION'))
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_precios_no_negativos_chk";

-- `cantidadExacta` es la magnitud sin redondear de la misma fila: tiene el signo de `cantidad` (o `cantidad` quedó en 0 por el redondeo).
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_cantidad_exacta_signo_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_cantidad_exacta_signo_chk" CHECK (
  "cantidadExacta" IS NULL OR cantidad * "cantidadExacta" >= 0
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_cantidad_exacta_signo_chk";

-- Costo y precio de lista de una venta: solo existen en la línea VENTA y no son negativos.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_campos_de_venta_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_campos_de_venta_chk" CHECK (
  ("costoUnitarioVenta" IS NULL OR (proceso = 'VENTA' AND "costoUnitarioVenta" >= 0))
  AND ("precioListaUnitario" IS NULL OR (proceso = 'VENTA' AND "precioListaUnitario" >= 0))
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_campos_de_venta_chk";

-- El sustituto de una línea de receta solo lo escribe el consumo de una venta.
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_sustituye_solo_consumo_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_sustituye_solo_consumo_chk" CHECK (
  "sustituyeAProductoId" IS NULL OR proceso = 'CONSUMO'
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_sustituye_solo_consumo_chk";

-- Una línea ligada a un traspaso entre sucursales es de uno de sus tres pasos (salida, entrada, reingreso).
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_traspaso_solo_en_traspasos_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_traspaso_solo_en_traspasos_chk" CHECK (
  "traspasoSucursalId" IS NULL
  OR proceso IN ('TRANSFERENCIA_SALIDA_SUCURSAL', 'TRANSFERENCIA_ENTRADA_SUCURSAL', 'REINGRESO_TRANSFERENCIA_SUCURSAL')
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_traspaso_solo_en_traspasos_chk";

-- Una línea ligada a un conteo físico es CONTROL (el ajuste y su reversión al cancelar).
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_conteo_solo_en_control_chk";
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_conteo_solo_en_control_chk" CHECK (
  "conteoFisicoId" IS NULL OR proceso = 'CONTROL'
) NOT VALID;
ALTER TABLE "MovimientoStock" VALIDATE CONSTRAINT "MovimientoStock_conteo_solo_en_control_chk";

-- Cada paso de un traspaso escribe UNA línea: salida, entrada y reingreso no se repiten. Es la única regla de esta migración que mira
-- varias filas; si en alguna base hubiera un paso duplicado, se puede sacar de este bloque sin tocar el resto (ver la verificación previa).
CREATE UNIQUE INDEX IF NOT EXISTS "MovimientoStock_traspaso_paso_unico_key"
  ON "MovimientoStock" ("traspasoSucursalId", proceso)
  WHERE "traspasoSucursalId" IS NOT NULL;

-- ============================================================================================================================
-- Operacion
-- ============================================================================================================================

-- Motivo solo en la merma; destino solo en el consumo; sección de destino solo en la transferencia.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_motivo_solo_merma_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_motivo_solo_merma_chk" CHECK ("motivoId" IS NULL OR proceso = 'MERMA') NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_motivo_solo_merma_chk";

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_destino_solo_consumo_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_destino_solo_consumo_chk" CHECK ("destinoId" IS NULL OR proceso = 'CONSUMO') NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_destino_solo_consumo_chk";

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_seccion_destino_solo_transferencia_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_seccion_destino_solo_transferencia_chk" CHECK ("seccionDestinoId" IS NULL OR proceso = 'TRANSFERENCIA') NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_seccion_destino_solo_transferencia_chk";

-- La otra mitad: una transferencia siempre dice a qué sección va. Va aparte de la anterior porque es la que más probablemente toque filas
-- históricas anteriores al campo: si la verificación previa la marca en alguna base, se saca esta sola.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_transferencia_exige_seccion_destino_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_transferencia_exige_seccion_destino_chk" CHECK (proceso <> 'TRANSFERENCIA' OR "seccionDestinoId" IS NOT NULL) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_transferencia_exige_seccion_destino_chk";

-- Anulación: solo VENTA y COMPRA se anulan. `anuladaPorId` sin `anuladaEn` no existe; la inversa SÍ puede darse (la FK a User es SET NULL:
-- borrar al usuario que anuló deja `anuladaEn` y limpia `anuladaPorId`), por eso la regla va en un solo sentido.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_anulacion_coherente_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_anulacion_coherente_chk" CHECK (
  ("anuladaPorId" IS NULL OR "anuladaEn" IS NOT NULL)
  AND ("anuladaEn" IS NULL OR proceso IN ('VENTA', 'COMPRA'))
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_anulacion_coherente_chk";
