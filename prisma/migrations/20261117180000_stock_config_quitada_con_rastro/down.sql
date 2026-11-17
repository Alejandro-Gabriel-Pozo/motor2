-- Reversa de 20261117180000_stock_config_quitada_con_rastro. Borra las filas quitadas (sin la marca volverían a contar) y saca columnas y restricciones. Se puede correr dos veces.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StockMinimoProducto' AND column_name = 'quitadoEn') THEN
    DELETE FROM "StockMinimoProducto" WHERE "quitadoEn" IS NOT NULL;
  END IF;
END $$;
ALTER TABLE "StockMinimoProducto" DROP CONSTRAINT IF EXISTS "StockMinimoProducto_quitada_chk";
ALTER TABLE "StockMinimoProducto" DROP CONSTRAINT IF EXISTS "StockMinimoProducto_quitadoPorId_fkey";
ALTER TABLE "StockMinimoProducto" DROP COLUMN IF EXISTS "quitadoEn", DROP COLUMN IF EXISTS "quitadoPorId";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'SeccionHabitualProducto' AND column_name = 'quitadoEn') THEN
    DELETE FROM "SeccionHabitualProducto" WHERE "quitadoEn" IS NOT NULL;
  END IF;
END $$;
ALTER TABLE "SeccionHabitualProducto" DROP CONSTRAINT IF EXISTS "SeccionHabitualProducto_quitada_chk";
ALTER TABLE "SeccionHabitualProducto" DROP CONSTRAINT IF EXISTS "SeccionHabitualProducto_quitadoPorId_fkey";
ALTER TABLE "SeccionHabitualProducto" DROP COLUMN IF EXISTS "quitadoEn", DROP COLUMN IF EXISTS "quitadoPorId";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FrecuenciaConteoProducto' AND column_name = 'quitadoEn') THEN
    DELETE FROM "FrecuenciaConteoProducto" WHERE "quitadoEn" IS NOT NULL;
  END IF;
END $$;
ALTER TABLE "FrecuenciaConteoProducto" DROP CONSTRAINT IF EXISTS "FrecuenciaConteoProducto_quitada_chk";
ALTER TABLE "FrecuenciaConteoProducto" DROP CONSTRAINT IF EXISTS "FrecuenciaConteoProducto_quitadoPorId_fkey";
ALTER TABLE "FrecuenciaConteoProducto" DROP COLUMN IF EXISTS "quitadoEn", DROP COLUMN IF EXISTS "quitadoPorId";
