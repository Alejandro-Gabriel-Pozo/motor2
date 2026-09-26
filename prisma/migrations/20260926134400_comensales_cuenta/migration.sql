-- Migración de ESQUEMA, aditiva (docs/plan-comensales-y-limite-mesas-2026-09-26.md): columna nueva y nullable, SIN backfill —
-- las cuentas ya cerradas quedan con `comensales = NULL` a propósito (no se inventa un dato histórico que nunca se registró).
-- Generada con `prisma migrate dev --create-only`, sacando a mano el drop/add de las dos foreign key de "Operacion"
-- (motivoId/destinoId) que Prisma vuelve a proponer por la misma deriva esquema-vs-base que ya documentó
-- 20260925152432_pos_tomar_pedido: no son parte de este cambio.
--
-- `Cuenta.comensales`: cuántos comensales se sentaron. Obligatorio y sin valor por defecto al ABRIR la cuenta (`abrirCuenta`,
-- validado en la aplicación con `validarComensales`) — la columna es nullable solo para admitir las filas de antes de este
-- cambio. Se puede corregir mientras la cuenta sigue abierta (`corregirComensales`); al cerrarla queda congelado. Es SOLO para
-- medir rotación de mesas (Reportes › Rotación de mesas): no habilita dividir la cuenta por persona.

-- AlterTable
ALTER TABLE "Cuenta" ADD COLUMN     "comensales" INTEGER;
