-- Reversa de 20261001200000_i3_idempotencia_conteo_fisico: se pierden las claves de reintento ya guardadas (no los conteos).
DROP INDEX "ConteoFisico_claveIdempotencia_key";
ALTER TABLE "ConteoFisico" DROP COLUMN "claveIdempotencia", DROP COLUMN "payloadHash", DROP COLUMN "resultadoMensaje";
