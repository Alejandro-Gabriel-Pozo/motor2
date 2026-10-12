-- Reversa de 20261016112000_imputacion_de_gasto (Paquete 3, M4.3). DESTRUCTIVA si ya hay imputaciones: se pierde cuánto del gasto de cada renglón le tocaba a cada sucursal (y su IVA computable). Antes de bajar, contar y guardar:
--   SELECT count(*) FROM "ImputacionDeGasto";   y   pg_dump -t '"ImputacionDeGasto"'   si da más de 0 (antes de la Etapa C la tabla está vacía).
-- Bajar ANTES M4.4 (sus políticas viven sobre esta tabla) y ANTES que M4.2 (el índice `(empresaId, id, naturaleza)` lo usa la clave foránea de esta tabla). Orden de la reversa de M4: M4.5, M4.4, esta (M4.3), M4.2 y M4.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016112000_imputacion_de_gasto`. Idempotente (IF EXISTS).

DROP TABLE IF EXISTS "ImputacionDeGasto";
