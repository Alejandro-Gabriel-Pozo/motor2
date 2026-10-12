-- M2-1 (Paquete 2; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): las columnas de `Operacion` para las reversiones, el motivo de
-- anulación, la merma por anulación y el reemplazo de unidades, más el motivo de cancelación del conteo físico (D9).
--
-- POR QUÉ: hoy una reversión por anulación se reconoce por el COMIENZO DEL TEXTO de su descripción («Anulación de la venta …»), y dos anulaciones a la vez se frenan solo por el estado de la
-- operación original. Acá se agrega el enlace real: `revierteAOperacionId` (única por empresa: una operación se revierte UNA sola vez, y ese índice único es el árbitro de la carrera de dos
-- anulaciones a la vez), el motivo con que se anuló (`motivoAnulacion`; `ConteoFisico.motivoCancelacion` para los conteos), la merma de una venta anulada cuyo género no se recuperó
-- (`mermaPorAnulacionDeId`) y la venta que reemplaza a otra al anular y rehacer unidades (`reemplazaAOperacionId`).
--
-- ADITIVA: todas las columnas son NULLABLES y quedan en NULL; ningún código de `src/` las lee ni las escribe todavía (Etapa C), así que el código anterior sigue andando sobre la base nueva y el
-- Instant Rollback sigue siendo seguro. NO se rellena nada acá (el relleno de las reversiones viejas es una operación con datos, aparte y con su propia autorización). Con todo en NULL ningún
-- CHECK ni FK puede fallar: no hace falta verificación previa.
--
-- Las claves foráneas son COMPUESTAS (empresaId, x) → Operacion(empresaId, id), como las demás entre tablas de empresa: la empresa de las dos puntas coincide por construcción. Que la reversión sea
-- de la MISMA SUCURSAL que la operación revertida, y que la merma o el reemplazo apunten a una VENTA anulada, lo controla la aplicación (Etapa C) y lo verifica el relleno.
-- Cada CHECK se agrega `NOT VALID` y se valida en el mismo script (precedente 20261002160000); el script es idempotente.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261015120000_m2_operacion_reversiones_y_motivo`).
-- DESTRUCTIVA si ya hay datos: se pierden los motivos de anulación y de cancelación, los reemplazos y las mermas enlazadas (los enlaces de reversión se pueden rearmar desde el texto).

ALTER TABLE "Operacion"
  ADD COLUMN IF NOT EXISTS "revierteAOperacionId" TEXT,
  ADD COLUMN IF NOT EXISTS "motivoAnulacion" TEXT,
  ADD COLUMN IF NOT EXISTS "mermaPorAnulacionDeId" TEXT,
  ADD COLUMN IF NOT EXISTS "reemplazaAOperacionId" TEXT;

ALTER TABLE "ConteoFisico" ADD COLUMN IF NOT EXISTS "motivoCancelacion" TEXT;

-- Una sola reversión / merma / reemplazo por operación (Postgres admite muchos NULL en un índice único).
CREATE UNIQUE INDEX IF NOT EXISTS "Operacion_empresaId_revierteAOperacionId_key" ON "Operacion"("empresaId", "revierteAOperacionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Operacion_empresaId_mermaPorAnulacionDeId_key" ON "Operacion"("empresaId", "mermaPorAnulacionDeId");
CREATE UNIQUE INDEX IF NOT EXISTS "Operacion_empresaId_reemplazaAOperacionId_key" ON "Operacion"("empresaId", "reemplazaAOperacionId");

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_revierteAOperacionId_fkey";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_revierteAOperacionId_fkey" FOREIGN KEY ("empresaId", "revierteAOperacionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_mermaPorAnulacionDeId_fkey";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_mermaPorAnulacionDeId_fkey" FOREIGN KEY ("empresaId", "mermaPorAnulacionDeId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_empresaId_reemplazaAOperacionId_fkey";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_reemplazaAOperacionId_fkey" FOREIGN KEY ("empresaId", "reemplazaAOperacionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una reversión por anulación es una AJUSTE y nunca se revierte a sí misma.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_revierte_solo_ajuste_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_revierte_solo_ajuste_chk" CHECK (
  "revierteAOperacionId" IS NULL OR (proceso = 'AJUSTE' AND "revierteAOperacionId" <> id)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_revierte_solo_ajuste_chk";

-- El motivo de anulación solo existe en una operación anulada, no vacío y de hasta 200 caracteres (LARGO_MAXIMO_MOTIVO_ANULACION, src/core/texto.ts).
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_motivo_anulacion_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_motivo_anulacion_chk" CHECK (
  "motivoAnulacion" IS NULL OR ("anuladaEn" IS NOT NULL AND btrim("motivoAnulacion") <> '' AND char_length("motivoAnulacion") <= 200)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_motivo_anulacion_chk";

-- La merma por anulación es una MERMA y no se apunta a sí misma.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_merma_por_anulacion_solo_merma_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_merma_por_anulacion_solo_merma_chk" CHECK (
  "mermaPorAnulacionDeId" IS NULL OR (proceso = 'MERMA' AND "mermaPorAnulacionDeId" <> id)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_merma_por_anulacion_solo_merma_chk";

-- El reemplazo es una VENTA y no se reemplaza a sí misma.
ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_solo_venta_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_reemplaza_solo_venta_chk" CHECK (
  "reemplazaAOperacionId" IS NULL OR (proceso = 'VENTA' AND "reemplazaAOperacionId" <> id)
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_reemplaza_solo_venta_chk";

-- El motivo de cancelación del conteo solo existe en un conteo CANCELADO, no vacío y de hasta 200 caracteres.
ALTER TABLE "ConteoFisico" DROP CONSTRAINT IF EXISTS "ConteoFisico_motivo_cancelacion_chk";
ALTER TABLE "ConteoFisico" ADD CONSTRAINT "ConteoFisico_motivo_cancelacion_chk" CHECK (
  "motivoCancelacion" IS NULL OR (estado = 'CANCELADO' AND btrim("motivoCancelacion") <> '' AND char_length("motivoCancelacion") <= 200)
) NOT VALID;
ALTER TABLE "ConteoFisico" VALIDATE CONSTRAINT "ConteoFisico_motivo_cancelacion_chk";
