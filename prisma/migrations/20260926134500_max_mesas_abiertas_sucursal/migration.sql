-- Migración de ESQUEMA, aditiva (docs/plan-comensales-y-limite-mesas-2026-09-26.md): columna nueva y nullable.
--
-- `Sucursal.maxMesasAbiertas`: cupo de `Cuenta` con `cerradaEn IS NULL` (mesas "abiertas") a la vez en esa sucursal. `NULL`
-- (default, sin cambios para ninguna sucursal existente) = sin límite. Se edita con el mismo permiso que da de alta mesas
-- (`pos_mesas`, Editar — `actualizarMaxMesasAbiertas`, src/server/actions/pos/mesas.ts), auditado (`registrarCambioAuditado`,
-- entidad "Sucursal"). El chequeo del límite vive en la misma transacción SERIALIZABLE que crea la `Cuenta` (`abrirCuenta`):
-- bajarlo por debajo de las mesas ya abiertas no cierra ninguna, solo bloquea aperturas nuevas.

-- AlterTable
ALTER TABLE "Sucursal" ADD COLUMN     "maxMesasAbiertas" INTEGER;
