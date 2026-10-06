-- Un CUIT identifica a un solo proveedor por empresa y a una sola empresa (E2 paso 5, ADR-017; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, otorgada
-- por el dueño el 2026-10-03). Hasta hoy el CUIT era texto libre: el código ya lo valida y lo guarda canónico (11 dígitos, `core/fiscal/cuit.ts`), pero la
-- base no impedía repetirlo. Un mismo proveedor con otro punto de venta no es otro CUIT; dos filas con el mismo CUIT son un error de carga.
--
-- 1) Backfill sin pérdida de información: vacío → NULL, y los que son 11 dígitos con espacios, puntos o guiones → los 11 dígitos. Los que no
--    normalizan (inválidos) NO se tocan: no se adivina un dato fiscal. Las dos tablas (`Proveedor`, `Empresa`).
-- 2) Chequeo previo: si al normalizar queda un CUIT repetido (en la misma empresa para `Proveedor`; en toda la base para `Empresa`), la migración se
--    detiene con el detalle. Cuál fila queda es una decisión de negocio, no se resuelve sola.
-- 3) Índices únicos comunes, como los declara `schema.prisma` (`@@unique([empresaId, cuit])` y `@unique`): Postgres admite varios NULL, así que no hace
--    falta que sean parciales. En `Proveedor` va por empresa y no global: un índice global filtraría, por el error de unicidad, la existencia de un
--    proveedor de otra empresa.
-- Reversa: down.sql (los índices; el backfill no se revierte porque no pierde nada).

UPDATE "Proveedor" SET "cuit" = NULL WHERE btrim("cuit") = '';
UPDATE "Proveedor" SET "cuit" = regexp_replace("cuit", '[\s.-]', '', 'g') WHERE "cuit" IS NOT NULL AND regexp_replace("cuit", '[\s.-]', '', 'g') ~ '^[0-9]{11}$' AND "cuit" <> regexp_replace("cuit", '[\s.-]', '', 'g');
UPDATE "Empresa" SET "cuit" = NULL WHERE btrim("cuit") = '';
UPDATE "Empresa" SET "cuit" = regexp_replace("cuit", '[\s.-]', '', 'g') WHERE "cuit" IS NOT NULL AND regexp_replace("cuit", '[\s.-]', '', 'g') ~ '^[0-9]{11}$' AND "cuit" <> regexp_replace("cuit", '[\s.-]', '', 'g');

DO $$
DECLARE
  repetidos_proveedor text;
  repetidos_empresa text;
BEGIN
  SELECT string_agg(format('empresa %s: proveedores %s', "empresaId", ids), '; ')
    INTO repetidos_proveedor
    FROM (SELECT "empresaId", string_agg("id", ', ') AS ids FROM "Proveedor" WHERE "cuit" IS NOT NULL GROUP BY "empresaId", "cuit" HAVING count(*) > 1) d;
  SELECT string_agg(ids, '; ')
    INTO repetidos_empresa
    FROM (SELECT string_agg("id", ', ') AS ids FROM "Empresa" WHERE "cuit" IS NOT NULL GROUP BY "cuit" HAVING count(*) > 1) d;
  IF repetidos_proveedor IS NOT NULL OR repetidos_empresa IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede crear el índice de CUIT único. Proveedores con el mismo CUIT en una empresa: %. Empresas con el mismo CUIT: %. Corregí o vaciá el CUIT de las filas repetidas y volvé a migrar.', coalesce(repetidos_proveedor, 'ninguno'), coalesce(repetidos_empresa, 'ninguna');
  END IF;
END
$$;

CREATE UNIQUE INDEX "Proveedor_empresaId_cuit_key" ON "Proveedor"("empresaId", "cuit");
CREATE UNIQUE INDEX "Empresa_cuit_key" ON "Empresa"("cuit");
