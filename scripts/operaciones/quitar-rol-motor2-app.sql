-- Reversa de crear-rol-motor2-app.sql (ADR-007 paso A0).
--   psql -U postgres -h localhost -f scripts/operaciones/quitar-rol-motor2-app.sql

\connect motor2_dev
DROP OWNED BY motor2_app;
\connect motor2_e2e
DROP OWNED BY motor2_app;
DROP ROLE IF EXISTS motor2_app;
