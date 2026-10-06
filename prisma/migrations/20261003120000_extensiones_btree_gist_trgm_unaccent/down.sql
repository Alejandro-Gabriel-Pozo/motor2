-- Deshace 20261003120000_extensiones_btree_gist_trgm_unaccent: saca las tres extensiones.
-- Prisma no ejecuta este archivo; se corre a mano si hay que volver atrás, y después se marca la migración con `prisma migrate resolve --rolled-back`.
-- Sin CASCADE a propósito: si algún índice o regla ya depende de una extensión, esto FALLA en vez de borrarlo en silencio (primero hay que deshacer lo que la usa).

DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS btree_gist;
