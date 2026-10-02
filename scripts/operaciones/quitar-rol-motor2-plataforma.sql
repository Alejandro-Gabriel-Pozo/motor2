-- Reversa de crear-rol-motor2-plataforma.sql (S-13): le devuelve a motor2_app la escritura sobre `Empresa` y elimina `motor2_plataforma`.
-- Antes de correrlo, los scripts de plataforma tienen que dejar de usar PLATAFORMA_DATABASE_URL.
--   psql <conexión del dueño a la base> -f scripts/operaciones/quitar-rol-motor2-plataforma.sql

\set ON_ERROR_STOP on

GRANT INSERT, UPDATE, DELETE ON "Empresa" TO motor2_app;
DROP OWNED BY motor2_plataforma;
DROP ROLE IF EXISTS motor2_plataforma;
