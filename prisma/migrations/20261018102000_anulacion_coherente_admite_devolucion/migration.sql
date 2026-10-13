-- Paquete 4, M6.3 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la regla `Operacion_anulacion_coherente_chk` admite anular una `DEVOLUCION_PROVEEDOR` (además de la VENTA y la COMPRA).
-- Por qué: anular una nota de crédito de proveedor sobre mercadería revierte la devolución que acreditaba (se marca `anuladaEn` en la `Operacion` DEVOLUCION_PROVEEDOR y se agrega su reversión, como en la compra y la venta). Con la regla de hoy la base rechazaría esa anulación.
-- Qué NO cambia: `anuladaPorId` sin `anuladaEn` sigue sin existir, y AJUSTE, MERMA, TRANSFERENCIA y las demás siguen sin poder anularse.
-- ADITIVA: AFLOJA la regla, así que las filas de hoy la cumplen. Se reemplaza el CHECK (NOT VALID y después VALIDATE, como la migración original 20261002160000): el DROP y el ADD toman un ACCESS EXCLUSIVE breve sobre `Operacion` y el VALIDATE recorre
-- la tabla entera DENTRO de la misma transacción que corre Prisma. Se aplica con `SET lock_timeout = '5s'`. Guarda de volumen: con más de 500.000 operaciones, el VALIDATE se pasa a un archivo aparte de una sola sentencia y se corre fuera de horario.
-- Este archivo NO lleva bloques DO: la prueba `test/persistencia/reglas-operacion-movimiento.test.ts` lo vuelve a correr después de la migración original y lo parte sentencia por sentencia.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; ABORTA si ya hay una devolución anulada, porque el CHECK anterior la rechazaría. Después `prisma migrate resolve --rolled-back 20261018102000_anulacion_coherente_admite_devolucion`).

ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_anulacion_coherente_chk";
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_anulacion_coherente_chk" CHECK (
  ("anuladaPorId" IS NULL OR "anuladaEn" IS NOT NULL)
  AND ("anuladaEn" IS NULL OR proceso IN ('VENTA', 'COMPRA', 'DEVOLUCION_PROVEEDOR'))
) NOT VALID;
ALTER TABLE "Operacion" VALIDATE CONSTRAINT "Operacion_anulacion_coherente_chk";
