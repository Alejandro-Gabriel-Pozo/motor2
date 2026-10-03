-- Verificación previa de 20261003120000_extensiones_btree_gist_trgm_unaccent. SOLO LEE (un SELECT).
-- Se corre con el rol dueño (el que migra) en CADA base (zuluhub, stockhneuquen) ANTES de aprobar la migración:
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261003120000_extensiones_btree_gist_trgm_unaccent/verificacion-previa.sql
-- `disponible` tiene que ser true en las tres (la base ofrece la extensión) y `instalada` dice si ya estaba (entonces la migración no hace nada).

SELECT n.name AS extension, e.name IS NOT NULL AS disponible, i.extname IS NOT NULL AS instalada, e.default_version AS version
FROM (VALUES ('btree_gist'), ('pg_trgm'), ('unaccent')) AS n(name)
LEFT JOIN pg_available_extensions e ON e.name = n.name
LEFT JOIN pg_extension i ON i.extname = n.name
ORDER BY n.name;
