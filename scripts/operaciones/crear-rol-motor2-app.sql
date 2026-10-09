-- ADR-007 paso A0: rol de ejecución `motor2_app` (sin superusuario, sin BYPASSRLS, no dueño).
-- Uso (como superusuario, la clave se pasa por variable psql, nunca queda en el repo):
--   psql -U postgres -h localhost -v clave="<clave nueva>" -f scripts/operaciones/crear-rol-motor2-app.sql
-- Idempotente: se puede correr de nuevo. Reversa: scripts/operaciones/quitar-rol-motor2-app.sql
-- Si la separación con `motor2_plataforma` ya está aplicada (crear-rol-motor2-plataforma.sql con restringir=1), correrlo con `-v restringir=1` para que no le devuelva la escritura de "Empresa" a la app (S-35).

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') AS crear \gset
\if :crear
  CREATE ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  ALTER ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\endif

\set ON_ERROR_STOP on

\connect motor2_dev
GRANT CONNECT ON DATABASE motor2_dev TO motor2_app;
GRANT USAGE ON SCHEMA public TO motor2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app;
-- S-35 (B-C20): este GRANT masivo le da a la app escritura sobre "Empresa"; sin esto, volver a correr el script desarmaba la separación con motor2_plataforma. Con `-v restringir=1`
-- (el mismo interruptor que crear-rol-motor2-plataforma.sql) se la quita a continuación: REVOKE ALL + GRANT SELECT + una aserción que falla si algo (PUBLIC, un rol del que es miembro, una columna) le sigue dando escritura (M.1-C2). Sin el interruptor, las bases locales de prueba la conservan: los tests escriben "Empresa" como motor2_app.
\if :{?restringir}
  REVOKE ALL ON "Empresa" FROM motor2_app;
  GRANT SELECT ON "Empresa" TO motor2_app;
  DO $$
  BEGIN
    IF has_table_privilege('motor2_app', 'public."Empresa"', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege('motor2_app', 'public."Empresa"', 'INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'M.1 - motor2_app sigue pudiendo escribir "Empresa" despues del REVOKE ALL: lo hereda de PUBLIC, de un rol del que es miembro o de un privilegio por columna. Revisalo con scripts/operaciones/verificar-grants-m1.sql.';
    END IF;
  END
  $$;
\endif
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO motor2_app;
ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO motor2_app;
ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO motor2_app;

\connect motor2_e2e
GRANT CONNECT ON DATABASE motor2_e2e TO motor2_app;
GRANT USAGE ON SCHEMA public TO motor2_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app;
\if :{?restringir}
  REVOKE ALL ON "Empresa" FROM motor2_app;
  GRANT SELECT ON "Empresa" TO motor2_app;
  DO $$
  BEGIN
    IF has_table_privilege('motor2_app', 'public."Empresa"', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege('motor2_app', 'public."Empresa"', 'INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'M.1 - motor2_app sigue pudiendo escribir "Empresa" despues del REVOKE ALL: lo hereda de PUBLIC, de un rol del que es miembro o de un privilegio por columna. Revisalo con scripts/operaciones/verificar-grants-m1.sql.';
    END IF;
  END
  $$;
\endif
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO motor2_app;
ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO motor2_app;
ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO motor2_app;

SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'motor2_app';
