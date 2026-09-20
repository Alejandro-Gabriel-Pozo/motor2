-- Índice único parcial que arbitra la condición de carrera de factura de
-- compra duplicada (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
-- §9.2/§11 — el resto de ese plan ya está implementado, ver
-- src/core/movimientos/idempotencia.ts; esto era lo único que faltaba).
-- No se puede declarar en schema.prisma: Prisma no soporta índices
-- parciales (WHERE) — mismo motivo que
-- prisma/migrations/20260915034450_indices_manuales/.
--
-- Deliberadamente NO filtra por anulación: hoy ninguna Operacion de
-- COMPRA puede tener "anuladaEn" distinto de null (ese campo es solo de
-- VENTA, ver el modelo Operacion en schema.prisma) — si en el futuro se
-- agrega anulación de compra (K1b/K1c, docs/pendientes-responsable-
-- 2026-09-20.md §2), este índice deberá recrearse con ese predicado.
--
-- Deliberadamente NO usa NULLS NOT DISTINCT (PG15+): mismo criterio que
-- el chequeo de aplicación de hoy (registrarMovimiento solo lo corre
-- `&& datos.proveedorId`), una compra sin proveedor no choca con otra —
-- paridad, no regresión (ver scripts/seed-demo-pizzeria.ts, compras de
-- "feria" sin proveedor).
--
-- CONCURRENTLY: no toma un lock exclusivo sobre Operacion mientras se
-- construye el índice (tabla de escritura frecuente en producción). Debe
-- ser la ÚNICA sentencia de este archivo — Postgres no permite
-- CREATE INDEX CONCURRENTLY dentro de un bloque de transacción, y
-- Prisma Migrate envuelve en una transacción cualquier archivo con más
-- de una sentencia.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Operacion_factura_unica_key"
  ON "Operacion" ("sucursalId", "proveedorId", "nroFactura")
  WHERE "nroFactura" IS NOT NULL AND proceso = 'COMPRA';
