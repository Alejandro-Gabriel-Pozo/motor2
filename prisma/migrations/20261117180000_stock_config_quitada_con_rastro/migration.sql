-- Quitar sin borrar (frente 3, etapa E-4(2); `docs/diseno-datos-e2-e4-plan-por-tabla-2026-11-16.md` §2, filas 3 a 5): el mínimo de stock, la sección habitual y la frecuencia de conteo dejan de borrarse.
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon). Decisión del dueño (2026-11-16): «Desactivado con rastro (Recomendada)»; el dueño autorizó el
-- 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar).
--
-- QUÉ: dos columnas NULAS por tabla, `quitadoEn` (TIMESTAMPTZ) y `quitadoPorId` (FK a User), siempre juntas (CHECK: o las dos o ninguna). Fila con `quitadoEn` = «quitada»: no cuenta (las lecturas la filtran);
-- volver a fijar el mismo valor la reactiva EN EL MISMO LUGAR (se conservan los índices únicos de hoy y los upsert de la app). Forma más barata que el plan (índice único «solo vigentes» + fila nueva): el rastro de cada
-- quita/alta anterior queda en la auditoría de cambios, y acá quedan quién y cuándo de la última quita. SIN cambio de privilegios: el REVOKE DELETE va en una migración POSTERIOR, cuando el código ya no borra.
-- Compatible hacia atrás: el código anterior no conoce las columnas (siguen nulas) y puede seguir borrando.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117180000_stock_config_quitada_con_rastro`). Pierde SOLO las marcas de quita: antes de bajar,
-- las filas quitadas (quitadoEn no nulo) se borran, porque sin la marca volverían a contar.

ALTER TABLE "StockMinimoProducto" ADD COLUMN "quitadoEn" TIMESTAMPTZ(3), ADD COLUMN "quitadoPorId" TEXT;
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_quitada_chk" CHECK (("quitadoEn" IS NULL) = ("quitadoPorId" IS NULL));
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_quitadoPorId_fkey" FOREIGN KEY ("quitadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeccionHabitualProducto" ADD COLUMN "quitadoEn" TIMESTAMPTZ(3), ADD COLUMN "quitadoPorId" TEXT;
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_quitada_chk" CHECK (("quitadoEn" IS NULL) = ("quitadoPorId" IS NULL));
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_quitadoPorId_fkey" FOREIGN KEY ("quitadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FrecuenciaConteoProducto" ADD COLUMN "quitadoEn" TIMESTAMPTZ(3), ADD COLUMN "quitadoPorId" TEXT;
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_quitada_chk" CHECK (("quitadoEn" IS NULL) = ("quitadoPorId" IS NULL));
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_quitadoPorId_fkey" FOREIGN KEY ("quitadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

