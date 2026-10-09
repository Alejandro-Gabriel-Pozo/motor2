-- ADR-007 paso A0: rol de ejecución `motor2_app` (sin superusuario, sin BYPASSRLS, no dueño).
-- Uso (como superusuario, la clave se pasa por variable psql, nunca queda en el repo):
--   psql -U postgres -h localhost -v clave="<clave nueva>" -f scripts/operaciones/crear-rol-motor2-app.sql
-- Idempotente: se puede correr de nuevo. Reversa: scripts/operaciones/quitar-rol-motor2-app.sql
-- Si la separación con `motor2_plataforma` ya está aplicada (crear-rol-motor2-plataforma.sql con restringir=1), correrlo con `-v restringir=1` para que no le devuelva la escritura de "Empresa" a la app (S-35).
--
-- Solo bases locales y de CI; NUNCA en Neon (M.1-C5). Este script es de las bases locales: se conecta a `motor2_dev` y a `motor2_e2e` por nombre y, si el rol `motor2_app` ya existe, le CAMBIA la
-- contraseña (`ALTER ROLE … PASSWORD`). Contra Neon rotaría la credencial de la app de producción y la tiraría. En producción el rol de la app ya existe y NO se toca: el procedimiento de M.1 es
-- SOLO `crear-rol-motor2-plataforma.sql -v restringir=1` (sin clave) por el ejecutor, con `--simular` primero. Por eso, lo PRIMERO que hace es `\set ON_ERROR_STOP on` y lo SEGUNDO una guarda que aborta,
-- antes de tocar ningún rol, si en el servidor no existen las dos bases locales (o si existe el rol `neon_superuser`, que solo hay en Neon).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'motor2_dev')
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'motor2_e2e')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    RAISE EXCEPTION 'M.1 - crear-rol-motor2-app.sql es solo para bases locales y de CI (motor2_dev y motor2_e2e en un Postgres sin neon_superuser); NUNCA en Neon. No se toco ningun rol.';
  END IF;
END
$$;

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') AS crear \gset
\if :crear
  CREATE ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  ALTER ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\endif

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
