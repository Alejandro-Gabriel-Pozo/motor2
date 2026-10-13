-- Reversa de 20261015120000_m2_operacion_reversiones_y_motivo. DESTRUCTIVA si ya hay datos: se pierden los motivos de anulación (Operacion y ConteoFisico), los reemplazos y las mermas enlazadas;
-- los enlaces de reversión se pueden rearmar desde el texto de la descripción. Antes de bajar, contar: `SELECT count(*) FROM "Operacion" WHERE "revierteAOperacionId" IS NOT NULL OR "motivoAnulacion" IS NOT NULL
-- OR "mermaPorAnulacionDeId" IS NOT NULL OR "reemplazaAOperacionId" IS NOT NULL` y `SELECT count(*) FROM "ConteoFisico" WHERE "motivoCancelacion" IS NOT NULL`.
-- Recomendación: bajar M2 solo ANTES de desplegar la Etapa C (con todo en NULL no se pierde nada). Orden de la reversa del Paquete 2: M2-4, M2-3, M2-2 y esta (M2-1) al final.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261015120000_m2_operacion_reversiones_y_motivo`. Idempotente (IF EXISTS).

ALTER TABLE "ConteoFisico" DROP CONSTRAINT IF EXISTS "ConteoFisico_motivo_cancelacion_chk";
ALTER TABLE "ConteoFisico" DROP COLUMN IF EXISTS "motivoCancelacion";

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_revierte_solo_ajuste_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_motivo_anulacion_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_merma_por_anulacion_solo_merma_chk";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_solo_venta_chk";

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_revierteAOperacionId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_mermaPorAnulacionDeId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_reemplazaAOperacionId_fkey";

DROP INDEX IF EXISTS "Operacion_empresaId_revierteAOperacionId_key";
DROP INDEX IF EXISTS "Operacion_empresaId_mermaPorAnulacionDeId_key";
DROP INDEX IF EXISTS "Operacion_empresaId_reemplazaAOperacionId_key";

ALTER TABLE "Operacion"
  DROP COLUMN IF EXISTS "revierteAOperacionId",
  DROP COLUMN IF EXISTS "motivoAnulacion",
  DROP COLUMN IF EXISTS "mermaPorAnulacionDeId",
  DROP COLUMN IF EXISTS "reemplazaAOperacionId";
