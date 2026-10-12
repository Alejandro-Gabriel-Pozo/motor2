-- Reversa de 20261016110000_concepto_de_gasto (Paquete 3, M4.1). DESTRUCTIVA si ya hay conceptos de gasto: se pierde el catálogo de la empresa. Antes de bajar, contar y guardar:
--   SELECT count(*) FROM "ConceptoDeGasto";   y   pg_dump -t '"ConceptoDeGasto"'   si da más de 0 (antes de la Etapa C la tabla está vacía).
-- Bajar ANTES M4.2 (el renglón sin stock la referencia con una clave foránea: sin CASCADE, el DROP falla a propósito mientras M4.2 siga subida). Orden de la reversa de M4: M4.5, M4.4, M4.3, M4.2 y esta (M4.1).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261016110000_concepto_de_gasto`. Idempotente (IF EXISTS).

DROP TABLE IF EXISTS "ConceptoDeGasto";
