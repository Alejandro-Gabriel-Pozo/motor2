-- Reversa de 20261106100000_motivo_ambito_correccion. Antes de bajar: ninguna corrección puede estar usando un motivo sembrado (`Operacion.motivoId` apunta con RESTRICT); si lo usa, el DELETE falla y no se baja.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261106100000_motivo_ambito_correccion`. Idempotente (IF EXISTS).

DELETE FROM "MotivoMerma" WHERE "ambito" = 'CORRECCION' OR "nombre" IN ('Error de tipeo', 'Faltó cargar el precio', 'Cantidad mal cargada', 'Producto equivocado');
UPDATE "MotivoMerma" SET "ambito" = 'MERMA' WHERE "nombre" = 'Otro';
ALTER TABLE "MotivoMerma" DROP CONSTRAINT IF EXISTS "MotivoMerma_ambito_chk";
ALTER TABLE "MotivoMerma" DROP COLUMN IF EXISTS "ambito";
