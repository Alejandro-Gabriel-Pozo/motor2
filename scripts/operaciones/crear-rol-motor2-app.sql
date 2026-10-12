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
--
-- M.3-A8: rol de PRUEBAS `motor2_app_pruebas`, OPCIONAL: solo se crea (o se pone al día) si se pasa también `-v clave_pruebas="<clave descartable>"`; sin esa variable el script hace exactamente lo de siempre.
--   psql -U postgres -h localhost -v clave="<clave>" -v clave_pruebas="<otra clave descartable>" -f scripts/operaciones/crear-rol-motor2-app.sql
-- Es el rol con el que los FIXTURES de test siembran datos (`MOTOR2_PRUEBAS_DATABASE_URL`, ver .env.example): login, sin superusuario, sin BYPASSRLS, NO miembro de `motor2_app` (ni de ningún rol) y con los
-- MISMOS privilegios que `motor2_app` (incluida la restricción de solo lectura sobre "Empresa" con `restringir`). Las políticas por sucursal de la Fase B se escriben `TO motor2_app`: este rol no las alcanza,
-- así los fixtures siembran todas las sucursales y el código bajo prueba (que corre como `motor2_app`) sí queda restringido. Existe SOLO acá: jamás en un script pensado para Neon (lo guarda
-- `test/arquitectura/rol-de-pruebas-solo-local.test.ts`) y todo lo suyo viene DESPUÉS de la guarda de arriba. Idempotente; no cambia la clave de `motor2_app`. Si falla la verificación de membresías o de grants
-- el script aborta (falla cerrado). Quitarlo: `DROP OWNED BY motor2_app_pruebas;` en cada base local y `DROP ROLE motor2_app_pruebas;` (a mano, como superusuario).
-- `solo_pruebas=1` también hace falta después de `crear-rol-motor2-plataforma.sql -v restringir=1` en una base local (el recorte de "Empresa" es solo de `motor2_app`) y de cualquier otro cambio de privilegios de `motor2_app`.
-- Los marcadores `-- [A8:…]` delimitan los bloques que prueba `test/operaciones/rol-de-pruebas-con-base.test.ts`.

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

-- M.3-A8: con `-v solo_pruebas=1` (y `-v clave_pruebas=…`) el script NO toca a `motor2_app` (ni su rol ni sus grants): solo pone al día el rol de pruebas. Es el paso para correr DESPUÉS de `prisma migrate deploy`
-- (las migraciones recortan privilegios de `motor2_app` en algunas tablas; el rol de pruebas los copia de lo que `motor2_app` tiene en ese momento). Sin `solo_pruebas` el script es el de siempre.
-- Los bloques de `motor2_app` de las dos secciones de abajo van entre `\if :app_completo` y `\endif` SIN re-sangrar, para no mover las líneas que miran los guardianes de M.1.
SELECT NOT :{?solo_pruebas} AS app_completo \gset
SELECT (:{?solo_pruebas} AND NOT :{?clave_pruebas}) AS solo_pruebas_sin_clave \gset
\if :solo_pruebas_sin_clave
  DO $$
  BEGIN
    RAISE EXCEPTION 'M.3-A8 - solo_pruebas exige tambien -v clave_pruebas="<clave descartable>": sin ella no hay nada que hacer. No se toco ningun rol.';
  END
  $$;
\endif

\if :app_completo
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') AS crear \gset
\if :crear
  CREATE ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\else
  ALTER ROLE motor2_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'clave';
\endif
\endif

-- M.3-A8: el rol de pruebas. Va DESPUÉS de la guarda de bases y de Neon (primer DO) y solo si se pasó `clave_pruebas`.
-- [A8:decision]
-- (los dos \set dan un valor a las variables de los \if anidados: el ejecutor de `ejecutar-sql-de-psql.mjs` y los tests evalúan el \if aunque la rama esté salteada; psql no lo hace y no le cambia nada)
\set clave_vacia f
\set crear_pruebas f
SELECT :{?clave_pruebas} AS con_pruebas \gset
\if :con_pruebas
  -- [A8:rol:inicio]
  SELECT (:'clave_pruebas' = '') AS clave_vacia \gset
  \if :clave_vacia
    DO $$
    BEGIN
      RAISE EXCEPTION 'M.3-A8 - clave_pruebas llego vacia: un rol con LOGIN y sin contrasena no sirve. Pasa -v clave_pruebas="<clave descartable>" o no la pases. No se toco ningun rol de pruebas.';
    END
    $$;
  \endif
  SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app_pruebas') AS crear_pruebas \gset
  \if :crear_pruebas
    CREATE ROLE motor2_app_pruebas LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'clave_pruebas';
  \else
    ALTER ROLE motor2_app_pruebas LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'clave_pruebas';
  \endif
  -- Las políticas por sucursal son `TO motor2_app`: si el rol de pruebas fuera miembro de motor2_app (o de cualquier otro rol, incluido el dueño) las alcanzarían o saltarían el aislamiento. No se corrige en silencio: se aborta.
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'motor2_app_pruebas') THEN
      RAISE EXCEPTION 'M.3-A8 - motor2_app_pruebas es miembro de otro rol (motor2_app o el dueno): las politicas TO motor2_app o los privilegios del dueno lo alcanzarian. Sacalo a mano con REVOKE <rol> FROM motor2_app_pruebas.';
    END IF;
  END
  $$;
  -- [A8:rol:fin]
\else
  DO $$
  BEGIN
    RAISE NOTICE 'M.3-A8 - sin -v clave_pruebas: no se crea ni se actualiza el rol de pruebas motor2_app_pruebas (los fixtures de test caen en motor2_app y avisan).';
  END
  $$;
\endif
-- [A8:decision:fin]

\connect motor2_dev
\if :app_completo
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
\endif
-- M.3-A8: los mismos privilegios para el rol de pruebas. Se COPIAN tabla por tabla, secuencia por secuencia y columna por columna de lo que `motor2_app` tiene en este momento (parte de cero por objeto, así
-- que converge si alguien le dio de más): "Empresa" queda como la dejó M.1 (solo lectura con `restringir`) y las tablas que las migraciones recortan (RegistroAuditoria, Invitacion…) también. Una aserción final
-- ABORTA si algún privilegio efectivo de las dos cuentas difiere. Los privilegios por defecto cubren las tablas que se creen después (en CI se corre `solo_pruebas` de nuevo tras migrar para copiar los recortes).
\if :con_pruebas
  -- [A8:grants:inicio]
  GRANT CONNECT ON DATABASE motor2_dev TO motor2_app_pruebas;
  GRANT USAGE ON SCHEMA public TO motor2_app_pruebas;
  DO $$
  DECLARE
    o record;
    a record;
    p text;
  BEGIN
    FOR o IN SELECT c.oid, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') LOOP
      IF o.relkind = 'S' THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM motor2_app_pruebas', o.relname);
        FOREACH p IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
          IF has_sequence_privilege('motor2_app', o.oid, p) THEN
            EXECUTE format('GRANT %s ON SEQUENCE public.%I TO motor2_app_pruebas', p, o.relname);
          END IF;
        END LOOP;
      ELSE
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM motor2_app_pruebas', o.relname);
        FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
          IF has_table_privilege('motor2_app', o.oid, p) THEN
            EXECUTE format('GRANT %s ON TABLE public.%I TO motor2_app_pruebas', p, o.relname);
          END IF;
        END LOOP;
        FOR a IN
          SELECT t.attname, e.privilege_type
            FROM pg_attribute t, aclexplode(t.attacl) e
           WHERE t.attrelid = o.oid AND t.attnum > 0 AND NOT t.attisdropped AND e.grantee = 'motor2_app'::regrole
        LOOP
          EXECUTE format('GRANT %s (%I) ON TABLE public.%I TO motor2_app_pruebas', a.privilege_type, a.attname, o.relname);
        END LOOP;
      END IF;
    END LOOP;
  END
  $$;
  ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO motor2_app_pruebas;
  ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO motor2_app_pruebas;
  DO $$
  DECLARE
    diferencias text;
  BEGIN
    SELECT string_agg(d.x, ', ' ORDER BY d.x) INTO diferencias FROM (
      SELECT 'tabla ' || c.relname || ' ' || p AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege('motor2_app', c.oid, p) IS DISTINCT FROM has_table_privilege('motor2_app_pruebas', c.oid, p)
      UNION ALL
      SELECT 'secuencia ' || c.relname || ' ' || p
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
       WHERE n.nspname = 'public' AND c.relkind = 'S'
         AND has_sequence_privilege('motor2_app', c.oid, p) IS DISTINCT FROM has_sequence_privilege('motor2_app_pruebas', c.oid, p)
      UNION ALL
      SELECT 'columna ' || c.relname || '.' || a.attname || ' ' || p
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped,
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_column_privilege('motor2_app', c.oid, a.attnum, p) IS DISTINCT FROM has_column_privilege('motor2_app_pruebas', c.oid, a.attnum, p)
      UNION ALL
      SELECT 'esquema public ' || p
        FROM unnest(ARRAY['USAGE', 'CREATE']) p
       WHERE has_schema_privilege('motor2_app', 'public', p) IS DISTINCT FROM has_schema_privilege('motor2_app_pruebas', 'public', p)
      UNION ALL
      SELECT 'base ' || p
        FROM unnest(ARRAY['CONNECT', 'CREATE', 'TEMPORARY']) p
       WHERE has_database_privilege('motor2_app', current_database(), p) IS DISTINCT FROM has_database_privilege('motor2_app_pruebas', current_database(), p)
    ) d;
    IF diferencias IS NOT NULL THEN
      RAISE EXCEPTION 'M.3-A8 - motor2_app_pruebas no tiene los mismos privilegios que motor2_app en %: %', current_database(), left(diferencias, 400);
    END IF;
  END
  $$;
  -- [A8:grants:fin]
\endif

\connect motor2_e2e
\if :app_completo
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
\endif
-- M.3-A8: lo mismo que arriba, para la base E2E.
\if :con_pruebas
  -- [A8:grants:inicio]
  GRANT CONNECT ON DATABASE motor2_e2e TO motor2_app_pruebas;
  GRANT USAGE ON SCHEMA public TO motor2_app_pruebas;
  DO $$
  DECLARE
    o record;
    a record;
    p text;
  BEGIN
    FOR o IN SELECT c.oid, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') LOOP
      IF o.relkind = 'S' THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM motor2_app_pruebas', o.relname);
        FOREACH p IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
          IF has_sequence_privilege('motor2_app', o.oid, p) THEN
            EXECUTE format('GRANT %s ON SEQUENCE public.%I TO motor2_app_pruebas', p, o.relname);
          END IF;
        END LOOP;
      ELSE
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM motor2_app_pruebas', o.relname);
        FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
          IF has_table_privilege('motor2_app', o.oid, p) THEN
            EXECUTE format('GRANT %s ON TABLE public.%I TO motor2_app_pruebas', p, o.relname);
          END IF;
        END LOOP;
        FOR a IN
          SELECT t.attname, e.privilege_type
            FROM pg_attribute t, aclexplode(t.attacl) e
           WHERE t.attrelid = o.oid AND t.attnum > 0 AND NOT t.attisdropped AND e.grantee = 'motor2_app'::regrole
        LOOP
          EXECUTE format('GRANT %s (%I) ON TABLE public.%I TO motor2_app_pruebas', a.privilege_type, a.attname, o.relname);
        END LOOP;
      END IF;
    END LOOP;
  END
  $$;
  ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO motor2_app_pruebas;
  ALTER DEFAULT PRIVILEGES FOR ROLE motor2 IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO motor2_app_pruebas;
  DO $$
  DECLARE
    diferencias text;
  BEGIN
    SELECT string_agg(d.x, ', ' ORDER BY d.x) INTO diferencias FROM (
      SELECT 'tabla ' || c.relname || ' ' || p AS x
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege('motor2_app', c.oid, p) IS DISTINCT FROM has_table_privilege('motor2_app_pruebas', c.oid, p)
      UNION ALL
      SELECT 'secuencia ' || c.relname || ' ' || p
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
             unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
       WHERE n.nspname = 'public' AND c.relkind = 'S'
         AND has_sequence_privilege('motor2_app', c.oid, p) IS DISTINCT FROM has_sequence_privilege('motor2_app_pruebas', c.oid, p)
      UNION ALL
      SELECT 'columna ' || c.relname || '.' || a.attname || ' ' || p
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped,
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_column_privilege('motor2_app', c.oid, a.attnum, p) IS DISTINCT FROM has_column_privilege('motor2_app_pruebas', c.oid, a.attnum, p)
      UNION ALL
      SELECT 'esquema public ' || p
        FROM unnest(ARRAY['USAGE', 'CREATE']) p
       WHERE has_schema_privilege('motor2_app', 'public', p) IS DISTINCT FROM has_schema_privilege('motor2_app_pruebas', 'public', p)
      UNION ALL
      SELECT 'base ' || p
        FROM unnest(ARRAY['CONNECT', 'CREATE', 'TEMPORARY']) p
       WHERE has_database_privilege('motor2_app', current_database(), p) IS DISTINCT FROM has_database_privilege('motor2_app_pruebas', current_database(), p)
    ) d;
    IF diferencias IS NOT NULL THEN
      RAISE EXCEPTION 'M.3-A8 - motor2_app_pruebas no tiene los mismos privilegios que motor2_app en %: %', current_database(), left(diferencias, 400);
    END IF;
  END
  $$;
  -- [A8:grants:fin]
\endif

SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_app_pruebas') ORDER BY rolname;
