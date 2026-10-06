-- Deshace 20261002160000_reglas_en_la_base_operacion_movimiento: saca los CHECK y el índice único parcial. No toca datos.
-- Prisma no ejecuta este archivo; se corre a mano si hay que volver atrás, y después se marca la migración con `prisma migrate resolve --rolled-back`.

DROP INDEX IF EXISTS "MovimientoStock_traspaso_paso_unico_key";

ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_signo_por_proceso_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_precios_no_negativos_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_cantidad_exacta_signo_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_campos_de_venta_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_sustituye_solo_consumo_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_traspaso_solo_en_traspasos_chk";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT IF EXISTS "MovimientoStock_conteo_solo_en_control_chk";

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_motivo_solo_merma_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_destino_solo_consumo_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_seccion_destino_solo_transferencia_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_transferencia_exige_seccion_destino_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_anulacion_coherente_chk";
